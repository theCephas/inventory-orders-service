import { Response } from 'express';
import { STATUS_CODES } from 'http';

export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  path: string;
  timestamp: string;
}

export function sendErrorResponse(
  response: Response,
  statusCode: number,
  message: string,
  path: string,
  details?: unknown,
): void {
  const body: ErrorResponseBody = {
    statusCode,
    error: STATUS_CODES[statusCode] ?? 'Error',
    message,
    ...(details === undefined ? {} : { details }),
    path,
    timestamp: new Date().toISOString(),
  };
  response.status(statusCode).json(body);
}
