import { ApiProperty } from '@nestjs/swagger';

export class OrdersByStatusDto {
  @ApiProperty()
  pending: number;

  @ApiProperty()
  confirmed: number;

  @ApiProperty()
  shipped: number;

  @ApiProperty()
  cancelled: number;
}

export class TopProductDto {
  @ApiProperty({ format: 'uuid' })
  productId: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  unitsSold: number;

  @ApiProperty()
  revenueCents: number;
}

export class OrderSummaryDto {
  @ApiProperty({ example: '2026-01-01' })
  from: string;

  @ApiProperty({ example: '2026-12-31' })
  to: string;

  @ApiProperty()
  totalOrders: number;

  @ApiProperty({ description: 'Revenue in cents, excluding cancelled orders' })
  revenueCents: number;

  @ApiProperty()
  ordersByStatus: OrdersByStatusDto;

  @ApiProperty({ type: [TopProductDto], description: 'Top 5 products by units sold' })
  topProducts: TopProductDto[];
}
