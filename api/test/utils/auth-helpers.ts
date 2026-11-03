import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { seedDatabase } from '../../src/database/seed';

export const ADMIN_CREDENTIALS = { email: 'admin@test.local', password: 'admin-password' };

export async function login(
  app: INestApplication,
  email: string,
  password: string,
): Promise<string> {
  const response = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  return (response.body as { accessToken: string }).accessToken;
}

export async function registerCustomer(
  app: INestApplication,
  email: string,
  password = 'customer-password',
): Promise<string> {
  await request(app.getHttpServer())
    .post('/api/v1/auth/register')
    .send({ email, password })
    .expect(201);
  return login(app, email, password);
}

export async function seedAndLoginAdmin(
  app: INestApplication,
  dataSource: DataSource,
): Promise<string> {
  await seedDatabase(dataSource, ADMIN_CREDENTIALS);
  return login(app, ADMIN_CREDENTIALS.email, ADMIN_CREDENTIALS.password);
}
