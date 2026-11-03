import { INestApplication, ValidationPipe } from '@nestjs/common';

// Shared by main.ts and the e2e test factory so tests exercise the same pipeline as production.
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
}
