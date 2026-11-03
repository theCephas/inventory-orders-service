import request from 'supertest';
import {
  ADMIN_CREDENTIALS,
  login,
  registerCustomer,
  seedAndLoginAdmin,
} from './utils/auth-helpers';
import { createTestApp, resetDatabase, TestContext } from './utils/test-app';

describe('Auth (e2e)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.dataSource);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('POST /auth/register', () => {
    it('creates a customer, normalises the email and never returns the hash', async () => {
      const response = await http()
        .post('/api/v1/auth/register')
        .send({ email: '  Jane@Example.COM ', password: 'correct-horse' })
        .expect(201);

      expect(response.body).toEqual({
        id: expect.any(String),
        email: 'jane@example.com',
        role: 'customer',
        createdAt: expect.any(String),
      });
    });

    it('rejects a role in the body', async () => {
      const response = await http()
        .post('/api/v1/auth/register')
        .send({ email: 'sneaky@example.com', password: 'correct-horse', role: 'admin' })
        .expect(400);

      expect(response.body).toMatchObject({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        details: { errors: ['property role should not exist'] },
        path: '/api/v1/auth/register',
      });
      expect(response.body.timestamp).toEqual(expect.any(String));
    });

    it('rejects an invalid email and a short password', async () => {
      const response = await http()
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', password: 'short' })
        .expect(400);

      expect(response.body.details.errors).toHaveLength(2);
    });

    it('returns 409 for an email that is already registered, case-insensitively', async () => {
      await http()
        .post('/api/v1/auth/register')
        .send({ email: 'dupe@example.com', password: 'correct-horse' })
        .expect(201);

      const response = await http()
        .post('/api/v1/auth/register')
        .send({ email: 'DUPE@example.com', password: 'correct-horse' })
        .expect(409);

      expect(response.body.message).toBe('Email is already registered');
    });
  });

  describe('POST /auth/login', () => {
    beforeAll(async () => {
      await http()
        .post('/api/v1/auth/register')
        .send({ email: 'login@example.com', password: 'correct-horse' })
        .expect(201);
    });

    it('returns an access token for valid credentials', async () => {
      const response = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'LOGIN@example.com', password: 'correct-horse' })
        .expect(200);

      expect(response.body).toEqual({ accessToken: expect.any(String) });
    });

    it('returns the same error for a wrong password and an unknown email', async () => {
      const wrongPassword = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'login@example.com', password: 'wrong-password' })
        .expect(401);
      const unknownEmail = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'correct-horse' })
        .expect(401);

      expect(wrongPassword.body.message).toBe('Invalid email or password');
      expect(unknownEmail.body.message).toBe(wrongPassword.body.message);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the current user without the password hash', async () => {
      const token = await registerCustomer(ctx.app, 'me@example.com');

      const response = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual({
        id: expect.any(String),
        email: 'me@example.com',
        role: 'customer',
        createdAt: expect.any(String),
      });
    });

    it('returns 401 without a token or with an invalid token', async () => {
      await http().get('/api/v1/auth/me').expect(401);
      const response = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);

      expect(response.body).toMatchObject({ statusCode: 401, error: 'Unauthorized' });
    });
  });

  describe('seeded admin', () => {
    it('can log in and is reported as an admin', async () => {
      const token = await seedAndLoginAdmin(ctx.app, ctx.dataSource);

      const response = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toMatchObject({ email: ADMIN_CREDENTIALS.email, role: 'admin' });
    });

    it('seeding twice is a no-op', async () => {
      await seedAndLoginAdmin(ctx.app, ctx.dataSource);
      const [{ count }] = await ctx.dataSource.query<Array<{ count: string }>>(
        'SELECT count(*) FROM products',
      );

      expect(Number(count)).toBe(5);
      await login(ctx.app, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password);
    });
  });
});
