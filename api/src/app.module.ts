import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from './config/env.validation';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // The repo-root .env is shared with docker-compose; api/.env, if present, takes precedence.
      envFilePath: ['.env', '../.env'],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
