import request from 'supertest';
import { registerCustomer, seedAndLoginAdmin } from './utils/auth-helpers';
import { createTestApp, resetDatabase, TestContext } from './utils/test-app';

const newProduct = { sku: 'TEST-001', name: 'Test Widget', priceCents: 1500, stockQuantity: 7 };

describe('Products (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let customerToken: string;
  const http = () => request(ctx.app.getHttpServer());
  const asAdmin = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken}`);
  const asCustomer = (req: request.Test) => req.set('Authorization', `Bearer ${customerToken}`);

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.dataSource);
    adminToken = await seedAndLoginAdmin(ctx.app, ctx.dataSource);
    customerToken = await registerCustomer(ctx.app, 'shopper@example.com');
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('access control', () => {
    it('returns 401 when unauthenticated', async () => {
      await http().get('/api/v1/products').expect(401);
      await http().post('/api/v1/products').send(newProduct).expect(401);
    });

    it('forbids customers from creating, updating or deleting products', async () => {
      const [{ id }] = await ctx.dataSource.query<Array<{ id: string }>>(
        'SELECT id FROM products LIMIT 1',
      );
      const response = await asCustomer(http().post('/api/v1/products').send(newProduct)).expect(
        403,
      );
      expect(response.body).toMatchObject({ statusCode: 403, error: 'Forbidden' });

      await asCustomer(http().patch(`/api/v1/products/${id}`).send({ name: 'x' })).expect(403);
      await asCustomer(http().delete(`/api/v1/products/${id}`)).expect(403);
    });
  });

  describe('admin CRUD', () => {
    let productId: string;

    it('creates a product', async () => {
      const response = await asAdmin(http().post('/api/v1/products').send(newProduct)).expect(201);
      expect(response.body).toMatchObject({ ...newProduct, description: null, isActive: true });
      productId = response.body.id;
    });

    it('rejects a duplicate SKU with 409', async () => {
      const response = await asAdmin(http().post('/api/v1/products').send(newProduct)).expect(409);
      expect(response.body.message).toBe('A product with SKU TEST-001 already exists');
    });

    it('rejects negative prices, fractional stock and unknown fields', async () => {
      const response = await asAdmin(
        http()
          .post('/api/v1/products')
          .send({ ...newProduct, sku: 'BAD', priceCents: -1, stockQuantity: 1.5, colour: 'red' }),
      ).expect(400);
      expect(response.body.details.errors).toHaveLength(3);
    });

    it('updates a product', async () => {
      const response = await asAdmin(
        http().patch(`/api/v1/products/${productId}`).send({ priceCents: 1750 }),
      ).expect(200);
      expect(response.body).toMatchObject({ priceCents: 1750, name: newProduct.name });
    });

    it('soft deletes a product, hiding it from customers but not from admins', async () => {
      await asAdmin(http().delete(`/api/v1/products/${productId}`)).expect(204);

      await asCustomer(http().get(`/api/v1/products/${productId}`)).expect(404);
      const adminView = await asAdmin(http().get(`/api/v1/products/${productId}`)).expect(200);
      expect(adminView.body.isActive).toBe(false);

      const [{ count }] = await ctx.dataSource.query<Array<{ count: string }>>(
        'SELECT count(*) FROM products WHERE id = $1',
        [productId],
      );
      expect(Number(count)).toBe(1);
    });

    it('lists inactive products only for admins who ask for them', async () => {
      const skusOf = (body: { data: Array<{ sku: string }> }) => body.data.map((p) => p.sku);

      const customerList = await asCustomer(
        http().get('/api/v1/products?includeInactive=true'),
      ).expect(200);
      expect(skusOf(customerList.body)).not.toContain(newProduct.sku);

      const adminDefault = await asAdmin(http().get('/api/v1/products')).expect(200);
      expect(skusOf(adminDefault.body)).not.toContain(newProduct.sku);

      const adminAll = await asAdmin(http().get('/api/v1/products?includeInactive=true')).expect(
        200,
      );
      expect(skusOf(adminAll.body)).toContain(newProduct.sku);
    });

    it('can reactivate a soft-deleted product', async () => {
      await asAdmin(http().patch(`/api/v1/products/${productId}`).send({ isActive: true })).expect(
        200,
      );
      await asCustomer(http().get(`/api/v1/products/${productId}`)).expect(200);
    });

    it('returns 404 for an unknown product', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';
      await asAdmin(http().get(`/api/v1/products/${missing}`)).expect(404);
      await asAdmin(http().delete(`/api/v1/products/${missing}`)).expect(404);
    });

    it('returns 400 for a malformed id', async () => {
      await asAdmin(http().get('/api/v1/products/not-a-uuid')).expect(400);
    });
  });

  describe('pagination', () => {
    it('returns data with page metadata', async () => {
      const response = await asCustomer(http().get('/api/v1/products?page=2&limit=2')).expect(200);
      // 5 seeded + 1 created above.
      expect(response.body.meta).toEqual({ page: 2, limit: 2, total: 6 });
      expect(response.body.data).toHaveLength(2);
    });

    it('defaults to page 1, limit 20', async () => {
      const response = await asCustomer(http().get('/api/v1/products')).expect(200);
      expect(response.body.meta).toEqual({ page: 1, limit: 20, total: 6 });
    });

    it('rejects a limit above 100 and a page below 1', async () => {
      await asCustomer(http().get('/api/v1/products?limit=101')).expect(400);
      await asCustomer(http().get('/api/v1/products?page=0')).expect(400);
    });
  });
});
