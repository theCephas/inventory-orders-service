import { config } from 'dotenv';
import { resolve } from 'path';

/**
 * Points the app at the test database. Runs in Jest's globalSetup and in every test worker
 * (setupFiles) before AppModule is imported, so ConfigModule picks these values up.
 */
export const FAKE_REPORTING_PORT = 48080;

export function loadTestEnv(): string {
  config({ path: resolve(__dirname, '../../../.env') });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL must be set to run e2e tests');
  }
  // E2E tests truncate every table; refuse to run against anything that is not a test DB.
  if (!new URL(url).pathname.endsWith('_test')) {
    throw new Error(`Refusing to run e2e tests against non-test database: ${url}`);
  }
  process.env.DATABASE_URL = url;
  // The reports e2e suite runs a fake reporting service on this port.
  process.env.REPORTING_SERVICE_URL = `http://127.0.0.1:${FAKE_REPORTING_PORT}`;
  process.env.REPORTING_TIMEOUT_MS = '500';
  process.env.NODE_ENV = 'test';
  return url;
}
