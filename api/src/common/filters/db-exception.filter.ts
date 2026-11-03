import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { PgErrorCode, pgErrorCode } from '../../database/pg-error-codes';
import { sendErrorResponse } from './error-response';

const KNOWN_ERRORS: Record<string, { status: HttpStatus; message: string }> = {
  [PgErrorCode.UniqueViolation]: {
    status: HttpStatus.CONFLICT,
    message: 'A resource with the same unique value already exists',
  },
  [PgErrorCode.ForeignKeyViolation]: {
    status: HttpStatus.CONFLICT,
    message: 'The operation conflicts with a related resource',
  },
  [PgErrorCode.CheckViolation]: {
    status: HttpStatus.CONFLICT,
    message: 'The operation violates a data constraint',
  },
};

/** Maps Postgres errors that escape the services to HTTP responses without leaking SQL. */
@Catch(QueryFailedError)
export class DbExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DbExceptionFilter.name);

  catch(exception: QueryFailedError, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const known = KNOWN_ERRORS[pgErrorCode(exception) ?? ''];
    if (known) {
      this.logger.warn(`${request.method} ${request.url}: ${exception.message}`);
      sendErrorResponse(response, known.status, known.message, request.url);
      return;
    }

    this.logger.error(`Database error on ${request.method} ${request.url}`, exception.stack);
    sendErrorResponse(
      response,
      HttpStatus.INTERNAL_SERVER_ERROR,
      'Internal server error',
      request.url,
    );
  }
}
