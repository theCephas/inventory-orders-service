import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { sendErrorResponse } from './error-response';

/**
 * Catch-all filter: formats HttpExceptions into the shared error shape and turns anything
 * unexpected into a generic 500 so internals never reach the client.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    if (!(exception instanceof HttpException)) {
      this.logger.error(
        `Unhandled error on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      sendErrorResponse(
        response,
        HttpStatus.INTERNAL_SERVER_ERROR,
        'Internal server error',
        request.url,
      );
      return;
    }

    const { message, details } = this.extractMessageAndDetails(exception);
    sendErrorResponse(response, exception.getStatus(), message, request.url, details);
  }

  private extractMessageAndDetails(exception: HttpException): {
    message: string;
    details?: unknown;
  } {
    const body = exception.getResponse();
    if (typeof body === 'string') {
      return { message: body };
    }

    const { message, details } = body as { message?: unknown; details?: unknown };
    // ValidationPipe reports one message per failed constraint.
    if (Array.isArray(message)) {
      return { message: 'Validation failed', details: { errors: message } };
    }
    return { message: typeof message === 'string' ? message : exception.message, details };
  }
}
