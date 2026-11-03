import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, FindOptionsWhere, In, Repository } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { Paginated } from '../common/dto/paginated.dto';
import { MAX_INT32 } from '../products/dto/create-product.dto';
import { Product } from '../products/entities/product.entity';
import { UserRole } from '../users/entities/user.entity';
import { CreateOrderDto, OrderItemInputDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrderItem } from './entities/order-item.entity';
import { Order, OrderStatus } from './entities/order.entity';
import { canTransition } from './order-status-transitions';

/** Sums quantities per product. Ids are lowercased because IsUUID also accepts uppercase. */
export function mergeOrderLines(items: OrderItemInputDto[]): Map<string, number> {
  const quantities = new Map<string, number>();
  for (const { productId, quantity } of items) {
    const id = productId.toLowerCase();
    quantities.set(id, (quantities.get(id) ?? 0) + quantity);
  }
  return new Map([...quantities].sort(([a], [b]) => a.localeCompare(b)));
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Order) private readonly orders: Repository<Order>,
  ) {}

  placeOrder(userId: string, dto: CreateOrderDto): Promise<OrderResponseDto> {
    const requested = mergeOrderLines(dto.items);

    return this.dataSource.transaction(async (manager) => {
      const products = await this.lockProducts(manager, [...requested.keys()]);
      const productsById = new Map(products.map((product) => [product.id, product]));

      // Every check runs before the first write, so a rejected order changes nothing.
      let totalCents = 0;
      for (const [productId, quantity] of requested) {
        const product = productsById.get(productId);
        if (!product) {
          throw new NotFoundException({
            message: `Product ${productId} not found`,
            details: { productId },
          });
        }
        if (!product.isActive) {
          throw new UnprocessableEntityException({
            message: `Product ${productId} is no longer available`,
            details: { productId },
          });
        }
        if (product.stockQuantity < quantity) {
          throw new ConflictException({
            message: 'Insufficient stock',
            details: { productId, requested: quantity, available: product.stockQuantity },
          });
        }
        totalCents += product.priceCents * quantity;
      }
      if (totalCents > MAX_INT32) {
        throw new UnprocessableEntityException('Order total exceeds the maximum allowed amount');
      }

      for (const [productId, quantity] of requested) {
        await manager.decrement(Product, { id: productId }, 'stockQuantity', quantity);
      }

      const order = await manager.save(
        manager.create(Order, { userId, status: OrderStatus.Pending, totalCents }),
      );
      const items = await manager.save(
        [...requested].map(([productId, quantity]) =>
          manager.create(OrderItem, {
            orderId: order.id,
            productId,
            quantity,
            // Snapshot the price read under the row lock; the client never supplies prices.
            unitPriceCents: (productsById.get(productId) as Product).priceCents,
          }),
        ),
      );
      return OrderResponseDto.fromEntity(order, items);
    });
  }

  async listOrders(
    user: AuthUser,
    query: ListOrdersQueryDto,
  ): Promise<Paginated<OrderResponseDto>> {
    const where: FindOptionsWhere<Order> = {};
    if (query.status) {
      where.status = query.status;
    }
    if (user.role !== UserRole.Admin) {
      where.userId = user.userId;
    } else if (query.userId) {
      where.userId = query.userId;
    }

    const [orders, total] = await this.orders.findAndCount({
      where,
      relations: { items: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: query.skip,
      take: query.limit,
    });
    return {
      data: orders.map((order) => OrderResponseDto.fromEntity(order)),
      meta: { page: query.page, limit: query.limit, total },
    };
  }

  async getOrder(user: AuthUser, id: string): Promise<OrderResponseDto> {
    const order = await this.orders.findOne({
      where: { id, ...this.ownershipFilter(user) },
      relations: { items: true },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return OrderResponseDto.fromEntity(order);
  }

  cancelOrder(user: AuthUser, id: string): Promise<OrderResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.lockOrder(manager, id, user);
      if (user.role !== UserRole.Admin && order.status !== OrderStatus.Pending) {
        throw new ConflictException({
          message: `Only pending orders can be cancelled; this order is ${order.status}`,
          details: { status: order.status },
        });
      }
      return this.transitionLockedOrder(manager, order, OrderStatus.Cancelled);
    });
  }

  updateOrderStatus(id: string, status: OrderStatus): Promise<OrderResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const order = await this.lockOrder(manager, id);
      return this.transitionLockedOrder(manager, order, status);
    });
  }

  private async transitionLockedOrder(
    manager: EntityManager,
    order: Order,
    to: OrderStatus,
  ): Promise<OrderResponseDto> {
    if (!canTransition(order.status, to)) {
      throw new ConflictException({
        message: `Cannot change order status from ${order.status} to ${to}`,
        details: { from: order.status, to },
      });
    }

    const items = await manager.find(OrderItem, { where: { orderId: order.id } });
    // Cancelling through either endpoint must return the reserved stock.
    if (to === OrderStatus.Cancelled) {
      await this.lockProducts(
        manager,
        items.map((item) => item.productId),
      );
      for (const item of items) {
        await manager.increment(Product, { id: item.productId }, 'stockQuantity', item.quantity);
      }
    }

    order.status = to;
    return OrderResponseDto.fromEntity(await manager.save(order), items);
  }

  /**
   * SELECT ... FOR UPDATE ordered by id: concurrent transactions touching overlapping products
   * acquire the locks in the same order, so they queue instead of deadlocking.
   */
  private lockProducts(manager: EntityManager, ids: string[]): Promise<Product[]> {
    return manager.find(Product, {
      where: { id: In(ids) },
      order: { id: 'ASC' },
      lock: { mode: 'pessimistic_write' },
    });
  }

  private async lockOrder(manager: EntityManager, id: string, user?: AuthUser): Promise<Order> {
    const order = await manager.findOne(Order, {
      where: { id, ...(user ? this.ownershipFilter(user) : {}) },
      lock: { mode: 'pessimistic_write' },
    });
    if (!order) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }

  /** Customers only see their own orders; anyone else's is reported as not found (404, not 403). */
  private ownershipFilter(user: AuthUser): FindOptionsWhere<Order> {
    return user.role === UserRole.Admin ? {} : { userId: user.userId };
  }
}
