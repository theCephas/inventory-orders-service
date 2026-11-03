import request from 'supertest';
import { registerCustomer, seedAndLoginAdmin } from './utils/auth-helpers';
import { createTestApp, resetDatabase, TestContext } from './utils/test-app';

describe('Orders (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let aliceToken: string;
  let bobToken: string;
  let skuCounter = 0;

  const http = () => request(ctx.app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function createProduct(stockQuantity: number, priceCents = 1000): Promise<string> {
    const [{ id }] = await ctx.dataSource.query<Array<{ id: string }>>(
      `INSERT INTO products (sku, name, price_cents, stock_quantity)
       VALUES ($1, 'Test product', $2, $3) RETURNING id`,
      [`E2E-${++skuCounter}`, priceCents, stockQuantity],
    );
    return id;
  }

  async function stockOf(productId: string): Promise<number> {
    const [{ stock_quantity }] = await ctx.dataSource.query<Array<{ stock_quantity: number }>>(
      'SELECT stock_quantity FROM products WHERE id = $1',
      [productId],
    );
    return stock_quantity;
  }

  function placeOrder(token: string, items: Array<{ productId: string; quantity: number }>) {
    return http().post('/api/v1/orders').set(auth(token)).send({ items });
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.dataSource);
    adminToken = await seedAndLoginAdmin(ctx.app, ctx.dataSource);
    aliceToken = await registerCustomer(ctx.app, 'alice@example.com');
    bobToken = await registerCustomer(ctx.app, 'bob@example.com');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('placing orders', () => {
    it('a new customer registers, logs in and orders; stock drops and the total is correct', async () => {
      const token = await registerCustomer(ctx.app, 'carol@example.com');
      const keyboard = await createProduct(10, 8999);
      const cable = await createProduct(50, 999);

      const response = await placeOrder(token, [
        { productId: keyboard, quantity: 2 },
        { productId: cable, quantity: 1 },
        { productId: cable, quantity: 2 },
      ]).expect(201);

      expect(response.body).toMatchObject({ status: 'pending', totalCents: 2 * 8999 + 3 * 999 });
      expect(response.body.items).toHaveLength(2);
      expect(await stockOf(keyboard)).toBe(8);
      expect(await stockOf(cable)).toBe(47);
    });

    it('returns 409 with details when ordering more than the available stock, leaving stock unchanged', async () => {
      const plenty = await createProduct(10);
      const scarce = await createProduct(3);
      const [{ count: ordersBefore }] = await ctx.dataSource.query('SELECT count(*) FROM orders');

      const response = await placeOrder(aliceToken, [
        { productId: plenty, quantity: 1 },
        { productId: scarce, quantity: 4 },
      ]).expect(409);

      expect(response.body).toMatchObject({
        statusCode: 409,
        message: 'Insufficient stock',
        details: { productId: scarce, requested: 4, available: 3 },
      });
      expect(await stockOf(plenty)).toBe(10);
      expect(await stockOf(scarce)).toBe(3);
      const [{ count: ordersAfter }] = await ctx.dataSource.query('SELECT count(*) FROM orders');
      expect(ordersAfter).toBe(ordersBefore);
    });

    it('returns 404 for an unknown product and 422 for a deactivated one', async () => {
      const unknown = '00000000-0000-4000-8000-000000000000';
      const notFound = await placeOrder(aliceToken, [{ productId: unknown, quantity: 1 }]).expect(
        404,
      );
      expect(notFound.body.details).toEqual({ productId: unknown });

      const retired = await createProduct(5);
      await http().delete(`/api/v1/products/${retired}`).set(auth(adminToken)).expect(204);
      await placeOrder(aliceToken, [{ productId: retired, quantity: 1 }]).expect(422);
    });

    it('validates the body: 1 to 50 items, positive integer quantities', async () => {
      const productId = await createProduct(5);
      await placeOrder(aliceToken, []).expect(400);
      await placeOrder(aliceToken, [{ productId, quantity: 0 }]).expect(400);
      await placeOrder(
        aliceToken,
        Array.from({ length: 51 }, () => ({ productId, quantity: 1 })),
      ).expect(400);
      await http()
        .post('/api/v1/orders')
        .set(auth(aliceToken))
        .send({ items: [{ productId, quantity: 1, unitPriceCents: 1 }] })
        .expect(400);
    });

    it('requires authentication and the customer role', async () => {
      const productId = await createProduct(5);
      await http()
        .post('/api/v1/orders')
        .send({ items: [{ productId, quantity: 1 }] })
        .expect(401);
      await placeOrder(adminToken, [{ productId, quantity: 1 }]).expect(403);
    });

    it('does not let a customer create a product', async () => {
      await http()
        .post('/api/v1/products')
        .set(auth(aliceToken))
        .send({ sku: 'NOPE', name: 'Nope', priceCents: 1, stockQuantity: 1 })
        .expect(403);
    });
  });

  describe('reading orders', () => {
    let aliceOrderId: string;
    let bobOrderId: string;

    beforeAll(async () => {
      const productId = await createProduct(10);
      aliceOrderId = (await placeOrder(aliceToken, [{ productId, quantity: 1 }]).expect(201)).body
        .id;
      bobOrderId = (await placeOrder(bobToken, [{ productId, quantity: 1 }]).expect(201)).body.id;
    });

    it('lets a customer read their own order', async () => {
      const response = await http()
        .get(`/api/v1/orders/${aliceOrderId}`)
        .set(auth(aliceToken))
        .expect(200);
      expect(response.body.id).toBe(aliceOrderId);
    });

    it("returns 404 (not 403) when customer A requests customer B's order", async () => {
      await http().get(`/api/v1/orders/${bobOrderId}`).set(auth(aliceToken)).expect(404);
      await http().patch(`/api/v1/orders/${bobOrderId}/cancel`).set(auth(aliceToken)).expect(404);
    });

    it('lists only the customer’s own orders, but all orders for an admin', async () => {
      const aliceList = await http().get('/api/v1/orders').set(auth(aliceToken)).expect(200);
      const ids = (aliceList.body.data as Array<{ id: string; userId: string }>).map((o) => o.id);
      expect(ids).toContain(aliceOrderId);
      expect(ids).not.toContain(bobOrderId);

      const adminList = await http()
        .get('/api/v1/orders?limit=100')
        .set(auth(adminToken))
        .expect(200);
      const adminIds = (adminList.body.data as Array<{ id: string }>).map((o) => o.id);
      expect(adminIds).toEqual(expect.arrayContaining([aliceOrderId, bobOrderId]));
    });

    it('lets an admin filter by userId and status', async () => {
      const bob = await http().get(`/api/v1/orders/${bobOrderId}`).set(auth(adminToken));
      const filtered = await http()
        .get(`/api/v1/orders?userId=${bob.body.userId}&status=pending`)
        .set(auth(adminToken))
        .expect(200);

      expect(filtered.body.data.length).toBeGreaterThan(0);
      for (const order of filtered.body.data as Array<{ userId: string; status: string }>) {
        expect(order).toMatchObject({ userId: bob.body.userId, status: 'pending' });
      }
    });
  });

  describe('cancelling and status changes', () => {
    it('cancelling an order restores stock; cancelling again is a conflict', async () => {
      const productId = await createProduct(5);
      const order = await placeOrder(aliceToken, [{ productId, quantity: 3 }]).expect(201);
      expect(await stockOf(productId)).toBe(2);

      const cancelled = await http()
        .patch(`/api/v1/orders/${order.body.id}/cancel`)
        .set(auth(aliceToken))
        .expect(200);

      expect(cancelled.body.status).toBe('cancelled');
      expect(await stockOf(productId)).toBe(5);
      await http()
        .patch(`/api/v1/orders/${order.body.id}/cancel`)
        .set(auth(aliceToken))
        .expect(409);
      expect(await stockOf(productId)).toBe(5);
    });

    it('lets an admin move an order through pending -> confirmed -> shipped only', async () => {
      const productId = await createProduct(5);
      const { id } = (await placeOrder(aliceToken, [{ productId, quantity: 1 }]).expect(201)).body;
      const setStatus = (status: string) =>
        http().patch(`/api/v1/orders/${id}/status`).set(auth(adminToken)).send({ status });

      await setStatus('shipped').expect(409);
      await setStatus('confirmed').expect(200);

      // Once confirmed, the customer can no longer cancel.
      await http().patch(`/api/v1/orders/${id}/cancel`).set(auth(aliceToken)).expect(409);

      const shipped = await setStatus('shipped').expect(200);
      expect(shipped.body.status).toBe('shipped');

      const invalid = await setStatus('cancelled').expect(409);
      expect(invalid.body.details).toEqual({ from: 'shipped', to: 'cancelled' });
      expect(await stockOf(productId)).toBe(4);
    });

    it('restores stock when an admin cancels a confirmed order via the status endpoint', async () => {
      const productId = await createProduct(5);
      const { id } = (await placeOrder(aliceToken, [{ productId, quantity: 2 }]).expect(201)).body;
      await http()
        .patch(`/api/v1/orders/${id}/status`)
        .set(auth(adminToken))
        .send({ status: 'confirmed' })
        .expect(200);

      await http()
        .patch(`/api/v1/orders/${id}/status`)
        .set(auth(adminToken))
        .send({ status: 'cancelled' })
        .expect(200);

      expect(await stockOf(productId)).toBe(5);
    });

    it('does not let a customer use the status endpoint', async () => {
      const productId = await createProduct(5);
      const { id } = (await placeOrder(aliceToken, [{ productId, quantity: 1 }]).expect(201)).body;
      await http()
        .patch(`/api/v1/orders/${id}/status`)
        .set(auth(aliceToken))
        .send({ status: 'confirmed' })
        .expect(403);
    });
  });

  describe('concurrency', () => {
    it('two simultaneous orders for the last unit: exactly one 201 and one 409, stock ends at 0', async () => {
      const productId = await createProduct(1);

      const responses = await Promise.all([
        placeOrder(aliceToken, [{ productId, quantity: 1 }]),
        placeOrder(bobToken, [{ productId, quantity: 1 }]),
      ]);

      expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
      // The service's own check (under the row lock) rejects it, not the CHECK constraint fallback.
      const rejected = responses.find((r) => r.status === 409);
      expect(rejected?.body.details).toEqual({ productId, requested: 1, available: 0 });
      expect(await stockOf(productId)).toBe(0);
    });

    it('20 simultaneous orders for 5 units never oversell', async () => {
      const productId = await createProduct(5);

      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          placeOrder(i % 2 ? aliceToken : bobToken, [{ productId, quantity: 1 }]),
        ),
      );

      const statuses = responses.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(5);
      expect(statuses.filter((s) => s === 409)).toHaveLength(15);
      for (const response of responses.filter((r) => r.status === 409)) {
        expect(response.body.message).toBe('Insufficient stock');
      }
      expect(await stockOf(productId)).toBe(0);
    });

    it('orders listing the same products in opposite order do not deadlock', async () => {
      const first = await createProduct(100);
      const second = await createProduct(100);

      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          placeOrder(
            i % 2 ? aliceToken : bobToken,
            i % 2
              ? [
                  { productId: first, quantity: 1 },
                  { productId: second, quantity: 1 },
                ]
              : [
                  { productId: second, quantity: 1 },
                  { productId: first, quantity: 1 },
                ],
          ),
        ),
      );

      expect(responses.map((r) => r.status)).toEqual(Array(10).fill(201));
      expect(await stockOf(first)).toBe(90);
      expect(await stockOf(second)).toBe(90);
    });

    it('a cancellation racing a new order for the same stock stays consistent', async () => {
      const productId = await createProduct(1);
      const { id } = (await placeOrder(aliceToken, [{ productId, quantity: 1 }]).expect(201)).body;

      const [cancel, order] = await Promise.all([
        http().patch(`/api/v1/orders/${id}/cancel`).set(auth(aliceToken)),
        placeOrder(bobToken, [{ productId, quantity: 1 }]),
      ]);

      expect(cancel.status).toBe(200);
      // Bob's order either waited for the restored unit or lost the race; stock must match.
      expect(await stockOf(productId)).toBe(order.status === 201 ? 0 : 1);
    });
  });
});
