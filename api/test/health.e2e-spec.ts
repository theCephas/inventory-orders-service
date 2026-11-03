import request from 'supertest';
import { createTestApp, TestContext } from './utils/test-app';

describe('Health (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('GET /api/v1/health is public and returns ok', async () => {
    await request(ctx.app.getHttpServer()).get('/api/v1/health').expect(200, { status: 'ok' });
  });
});
