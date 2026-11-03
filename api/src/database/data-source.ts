import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './typeorm.options';

// The TypeORM CLI runs outside Nest, so it loads the same .env files as ConfigModule.
config({ path: resolve(process.cwd(), '.env') });
config({ path: resolve(process.cwd(), '../.env') });

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set');
}

export default new DataSource(buildDataSourceOptions(url));
