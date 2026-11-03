import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Product } from '../products/entities/product.entity';
import { UserRole } from '../users/entities/user.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { canTransition } from './order-status-transitions';
import { mergeOrderLines, OrdersService } from './orders.service';

const PRODUCT_A = '11111111-1111-4111-8111-111111111111';
const PRODUCT_B = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = { userId: 'customer-1', role: UserRole.Customer };

function product(overrides: Partial<Product>): Product {
  return { isActive: true, stockQuantity: 10, priceCents: 100, ...overrides } as Product;
}

/** A fake EntityManager that records writes and returns canned rows for reads. */
function fakeManager(rows: { products?: Product[]; order?: Order | null; items?: OrderItem[] }) {
  return {
    find: jest.fn(
      async (entity: unknown) => (entity === Product ? rows.products : rows.items) ?? [],
    ),
    findOne: jest.fn(async () => rows.order ?? null),
    create: jest.fn((_entity: unknown, values: object) => ({ ...values })),
    save: jest.fn(async (value: object | object[]) =>
      Array.isArray(value) ? value : { id: 'order-1', ...value },
    ),
    decrement: jest.fn(),
    increment: jest.fn(),
  };
}

function serviceWith(manager: ReturnType<typeof fakeManager>): OrdersService {
  const dataSource = {
    transaction: jest.fn((work: (m: EntityManager) => Promise<unknown>) =>
      work(manager as unknown as EntityManager),
    ),
  } as unknown as DataSource;
  return new OrdersService(dataSource, {} as Repository<Order>);
}

describe('OrdersService', () => {
  describe('placeOrder', () => {
    it('computes the total from the locked price snapshot, ignoring any client-supplied price', async () => {
      const manager = fakeManager({
        products: [
          product({ id: PRODUCT_A, priceCents: 1250 }),
          product({ id: PRODUCT_B, priceCents: 999 }),
        ],
      });
      const dto = {
        items: [
          { productId: PRODUCT_A, quantity: 2, unitPriceCents: 1 },
          { productId: PRODUCT_B, quantity: 3, priceCents: 1 },
        ],
      } as unknown as CreateOrderDto;

      const order = await serviceWith(manager).placeOrder('customer-1', dto);

      expect(order.totalCents).toBe(2 * 1250 + 3 * 999);
      expect(order.items).toEqual([
        { productId: PRODUCT_A, quantity: 2, unitPriceCents: 1250 },
        { productId: PRODUCT_B, quantity: 3, unitPriceCents: 999 },
      ]);
    });

    it('merges duplicate product lines before locking and inserting', async () => {
      const manager = fakeManager({ products: [product({ id: PRODUCT_A, priceCents: 500 })] });

      const order = await serviceWith(manager).placeOrder('customer-1', {
        items: [
          { productId: PRODUCT_A, quantity: 2 },
          { productId: PRODUCT_A.toUpperCase(), quantity: 3 },
        ],
      });

      expect(order.items).toEqual([{ productId: PRODUCT_A, quantity: 5, unitPriceCents: 500 }]);
      expect(order.totalCents).toBe(2500);
      expect(manager.decrement).toHaveBeenCalledTimes(1);
      expect(manager.decrement).toHaveBeenCalledWith(
        Product,
        { id: PRODUCT_A },
        'stockQuantity',
        5,
      );
    });

    it('throws a conflict with details when stock is insufficient, and writes nothing', async () => {
      const manager = fakeManager({
        products: [
          product({ id: PRODUCT_A, stockQuantity: 10 }),
          product({ id: PRODUCT_B, stockQuantity: 1 }),
        ],
      });

      const placing = serviceWith(manager).placeOrder('customer-1', {
        items: [
          { productId: PRODUCT_A, quantity: 1 },
          { productId: PRODUCT_B, quantity: 2 },
        ],
      });

      await expect(placing).rejects.toBeInstanceOf(ConflictException);
      await expect(placing).rejects.toMatchObject({
        response: { details: { productId: PRODUCT_B, requested: 2, available: 1 } },
      });
      expect(manager.decrement).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('rejects missing products with 404 and inactive products with 422', async () => {
      const missing = serviceWith(fakeManager({ products: [] })).placeOrder('c', {
        items: [{ productId: PRODUCT_A, quantity: 1 }],
      });
      await expect(missing).rejects.toBeInstanceOf(NotFoundException);

      const inactive = serviceWith(
        fakeManager({ products: [product({ id: PRODUCT_A, isActive: false })] }),
      ).placeOrder('c', { items: [{ productId: PRODUCT_A, quantity: 1 }] });
      await expect(inactive).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('status transitions', () => {
    it.each([
      [OrderStatus.Pending, OrderStatus.Confirmed, true],
      [OrderStatus.Confirmed, OrderStatus.Shipped, true],
      [OrderStatus.Pending, OrderStatus.Cancelled, true],
      [OrderStatus.Confirmed, OrderStatus.Cancelled, true],
      [OrderStatus.Pending, OrderStatus.Shipped, false],
      [OrderStatus.Shipped, OrderStatus.Cancelled, false],
      [OrderStatus.Cancelled, OrderStatus.Pending, false],
      [OrderStatus.Confirmed, OrderStatus.Pending, false],
    ])('%s -> %s allowed: %s', (from, to, allowed) => {
      expect(canTransition(from, to)).toBe(allowed);
    });

    it('rejects an invalid transition with a conflict and writes nothing', async () => {
      const manager = fakeManager({ order: { id: 'o1', status: OrderStatus.Shipped } as Order });

      await expect(
        serviceWith(manager).updateOrderStatus('o1', OrderStatus.Confirmed),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.increment).not.toHaveBeenCalled();
    });

    it('does not let a customer cancel a confirmed order', async () => {
      const manager = fakeManager({
        order: { id: 'o1', userId: 'customer-1', status: OrderStatus.Confirmed } as Order,
      });

      await expect(serviceWith(manager).cancelOrder(CUSTOMER, 'o1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('restores stock for every item when an order is cancelled', async () => {
      const manager = fakeManager({
        order: { id: 'o1', userId: 'customer-1', status: OrderStatus.Pending } as Order,
        items: [
          { productId: PRODUCT_A, quantity: 2 } as OrderItem,
          { productId: PRODUCT_B, quantity: 1 } as OrderItem,
        ],
      });

      const order = await serviceWith(manager).cancelOrder(CUSTOMER, 'o1');

      expect(order.status).toBe(OrderStatus.Cancelled);
      expect(manager.increment).toHaveBeenCalledWith(
        Product,
        { id: PRODUCT_A },
        'stockQuantity',
        2,
      );
      expect(manager.increment).toHaveBeenCalledWith(
        Product,
        { id: PRODUCT_B },
        'stockQuantity',
        1,
      );
    });
  });

  describe('mergeOrderLines', () => {
    it('sums quantities per product and sorts by id', () => {
      expect([
        ...mergeOrderLines([
          { productId: PRODUCT_B, quantity: 1 },
          { productId: PRODUCT_A, quantity: 2 },
          { productId: PRODUCT_B, quantity: 4 },
        ]),
      ]).toEqual([
        [PRODUCT_A, 2],
        [PRODUCT_B, 5],
      ]);
    });
  });
});
