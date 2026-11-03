import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../src/database/typeorm.options';
import { loadTestEnv } from './test-env';

export default async function globalSetup(): Promise<void> {
  const dataSource = new DataSource(buildDataSourceOptions(loadTestEnv()));
  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
}
