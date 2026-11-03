import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Only the format is checked here; the reporting service validates the dates and their order.
export class SummaryQueryDto {
  @ApiProperty({ example: '2026-01-01', description: 'Inclusive start date (YYYY-MM-DD, UTC)' })
  @Matches(DATE_ONLY, { message: 'from must be a date in YYYY-MM-DD format' })
  from: string;

  @ApiProperty({ example: '2026-12-31', description: 'Inclusive end date (YYYY-MM-DD, UTC)' })
  @Matches(DATE_ONLY, { message: 'to must be a date in YYYY-MM-DD format' })
  to: string;
}
