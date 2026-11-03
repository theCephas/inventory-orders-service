import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DbExceptionFilter } from './common/filters/db-exception.filter';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

// Shared by main.ts and the e2e test factory so tests exercise the same pipeline as production.
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // Nest tries global filters in reverse registration order, so the catch-all goes first.
  app.useGlobalFilters(new HttpExceptionFilter(), new DbExceptionFilter());
}
