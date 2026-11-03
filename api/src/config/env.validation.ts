import * as Joi from 'joi';

export interface EnvironmentVariables {
  NODE_ENV: 'development' | 'production' | 'test';
  PORT: number;
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  REPORTING_SERVICE_URL: string;
  INTERNAL_API_KEY: string;
  REPORTING_TIMEOUT_MS: number;
}

export const envValidationSchema = Joi.object<EnvironmentVariables, true>({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('1h'),
  REPORTING_SERVICE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required(),
  INTERNAL_API_KEY: Joi.string().min(32).required(),
  REPORTING_TIMEOUT_MS: Joi.number().integer().positive().default(3000),
});
