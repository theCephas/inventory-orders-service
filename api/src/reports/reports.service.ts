import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/env.validation';
import { OrderSummaryDto } from './dto/order-summary.dto';
import { SummaryQueryDto } from './dto/summary-query.dto';

const UNAVAILABLE_MESSAGE = 'Reporting service is unavailable, please try again later';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly config: ConfigService<EnvironmentVariables, true>) {}

  async getOrderSummary(query: SummaryQueryDto): Promise<OrderSummaryDto> {
    const url = new URL('/v1/summary', this.config.get('REPORTING_SERVICE_URL', { infer: true }));
    url.searchParams.set('from', query.from);
    url.searchParams.set('to', query.to);

    let status: number;
    let text: string;
    try {
      // The timeout covers the whole exchange, including reading the body.
      const response = await fetch(url, {
        headers: { 'X-Internal-Api-Key': this.config.get('INTERNAL_API_KEY', { infer: true }) },
        signal: AbortSignal.timeout(this.config.get('REPORTING_TIMEOUT_MS', { infer: true })),
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      this.logger.error(`Reporting service request failed: ${String(error)}`);
      throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
    }

    const body = parseJson(text);
    if (status === 400) {
      const message = (body as { error?: unknown } | undefined)?.error;
      throw new BadRequestException(
        typeof message === 'string' ? message : 'Invalid report parameters',
      );
    }
    if (status !== 200 || body === undefined) {
      // A 401 here means INTERNAL_API_KEY differs between the two services.
      this.logger.error(`Reporting service responded with ${status}: ${text.slice(0, 200)}`);
      throw new ServiceUnavailableException(UNAVAILABLE_MESSAGE);
    }
    return body as OrderSummaryDto;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
