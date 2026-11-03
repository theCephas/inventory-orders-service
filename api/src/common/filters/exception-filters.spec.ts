import { ConflictException, Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { QueryFailedError } from 'typeorm';
import { configureApp } from '../../app.setup';

function queryFailed(code: string): QueryFailedError {
  return new QueryFailedError(
    'INSERT INTO secret_table ...',
    [],
    Object.assign(new Error('raw'), { code }),
  );
}

@Controller('boom')
class BoomController {
  @Get('conflict')
  conflict(): never {
    throw new ConflictException({ message: 'Insufficient stock', details: { available: 0 } });
  }

  @Get('unique')
  unique(): never {
    throw queryFailed('23505');
  }

  @Get('unknown-db')
  unknownDb(): never {
    throw queryFailed('42P01');
  }

  @Get('crash')
  crash(): never {
    throw new Error('something internal');
  }
}

describe('exception filters', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [BoomController] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('formats HttpExceptions with message and details', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/boom/conflict').expect(409);
    expect(response.body).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'Insufficient stock',
      details: { available: 0 },
      path: '/api/v1/boom/conflict',
      timestamp: expect.any(String),
    });
  });

  it('maps a unique violation to 409 without leaking SQL', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/boom/unique').expect(409);
    expect(response.body.error).toBe('Conflict');
    expect(JSON.stringify(response.body)).not.toContain('secret_table');
  });

  it('maps unrecognised database errors to a generic 500', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/boom/unknown-db').expect(500);
    expect(response.body.message).toBe('Internal server error');
    expect(JSON.stringify(response.body)).not.toContain('secret_table');
  });

  it('maps unexpected errors to a generic 500', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/boom/crash').expect(500);
    expect(response.body).toMatchObject({ statusCode: 500, message: 'Internal server error' });
  });
});
