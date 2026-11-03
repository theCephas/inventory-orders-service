import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import request from 'supertest';
import { registerCustomer, seedAndLoginAdmin } from './utils/auth-helpers';
import { createTestApp, resetDatabase, TestContext } from './utils/test-app';
import { FAKE_REPORTING_PORT } from './utils/test-env';

const SUMMARY = {
  from: '2026-01-01',
  to: '2026-01-31',
  totalOrders: 3,
  revenueCents: 4500,
  ordersByStatus: { pending: 1, confirmed: 1, shipped: 0, cancelled: 1 },
  topProducts: [{ productId: 'p1', name: 'Keyboard', unitsSold: 2, revenueCents: 3000 }],
};

type Behaviour = 'ok' | 'bad-request' | 'slow' | 'unauthorized';

/** Stands in for the Go service so the API's proxying rules can be tested in isolation. */
function startFakeReportingService(state: {
  behaviour: Behaviour;
  lastRequest?: IncomingMessage;
}): Promise<Server> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    state.lastRequest = req;
    const reply = (status: number, body: unknown) =>
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));

    switch (state.behaviour) {
      case 'ok':
        return reply(200, SUMMARY);
      case 'bad-request':
        return reply(400, { error: "'from' must not be after 'to'" });
      case 'unauthorized':
        return reply(401, { error: 'missing or invalid internal API key' });
      case 'slow':
        setTimeout(() => reply(200, SUMMARY), 1500).unref();
        return;
    }
  });
  return new Promise((resolve) =>
    server.listen(FAKE_REPORTING_PORT, '127.0.0.1', () => resolve(server)),
  );
}

describe('Reports (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let customerToken: string;
  let fakeService: Server;
  const state: { behaviour: Behaviour; lastRequest?: IncomingMessage } = { behaviour: 'ok' };

  const getSummary = (query = 'from=2026-01-01&to=2026-01-31', token = adminToken) =>
    request(ctx.app.getHttpServer())
      .get(`/api/v1/reports/summary?${query}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.dataSource);
    adminToken = await seedAndLoginAdmin(ctx.app, ctx.dataSource);
    customerToken = await registerCustomer(ctx.app, 'reports-customer@example.com');
    fakeService = await startFakeReportingService(state);
  });

  afterAll(async () => {
    fakeService.closeAllConnections();
    await new Promise((resolve) => fakeService.close(resolve));
    await ctx.app.close();
  });

  beforeEach(() => {
    state.behaviour = 'ok';
    state.lastRequest = undefined;
  });

  it('proxies the summary for an admin, forwarding the internal API key and the date range', async () => {
    const response = await getSummary().expect(200);

    expect(response.body).toEqual(SUMMARY);
    expect(state.lastRequest?.headers['x-internal-api-key']).toBe(process.env.INTERNAL_API_KEY);
    expect(state.lastRequest?.url).toBe('/v1/summary?from=2026-01-01&to=2026-01-31');
  });

  it('is admin only', async () => {
    await getSummary(undefined, customerToken).expect(403);
    await request(ctx.app.getHttpServer()).get('/api/v1/reports/summary').expect(401);
    expect(state.lastRequest).toBeUndefined();
  });

  it('rejects malformed dates without calling the reporting service', async () => {
    const response = await getSummary('from=01-01-2026&to=2026-01-31').expect(400);

    expect(response.body.details.errors).toEqual(['from must be a date in YYYY-MM-DD format']);
    expect(state.lastRequest).toBeUndefined();
  });

  it("passes the reporting service's validation errors through as 400", async () => {
    state.behaviour = 'bad-request';
    const response = await getSummary('from=2026-02-01&to=2026-01-31').expect(400);

    expect(response.body.message).toBe("'from' must not be after 'to'");
  });

  it('returns 503 when the reporting service times out', async () => {
    state.behaviour = 'slow';
    const response = await getSummary().expect(503);

    expect(response.body).toMatchObject({
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Reporting service is unavailable, please try again later',
    });
  });

  it('returns 503 when the reporting service rejects the internal key', async () => {
    state.behaviour = 'unauthorized';
    await getSummary().expect(503);
  });

  it('returns 503 when the reporting service is down', async () => {
    fakeService.closeAllConnections();
    await new Promise((resolve) => fakeService.close(resolve));

    await getSummary().expect(503);

    fakeService = await startFakeReportingService(state);
  });
});
