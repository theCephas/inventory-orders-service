import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../users/entities/user.entity';
import { OrderSummaryDto } from './dto/order-summary.dto';
import { SummaryQueryDto } from './dto/summary-query.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('summary')
  @Roles(UserRole.Admin)
  @ApiOkResponse({ type: OrderSummaryDto })
  @ApiServiceUnavailableResponse({ description: 'Reporting service is down or timed out' })
  getOrderSummary(@Query() query: SummaryQueryDto): Promise<OrderSummaryDto> {
    return this.reportsService.getOrderSummary(query);
  }
}
