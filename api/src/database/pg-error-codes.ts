import { QueryFailedError } from 'typeorm';

// https://www.postgresql.org/docs/16/errcodes-appendix.html
export const PgErrorCode = {
  UniqueViolation: '23505',
  ForeignKeyViolation: '23503',
  CheckViolation: '23514',
} as const;

export function pgErrorCode(error: unknown): string | undefined {
  if (!(error instanceof QueryFailedError)) {
    return undefined;
  }
  const { code } = error.driverError as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}
