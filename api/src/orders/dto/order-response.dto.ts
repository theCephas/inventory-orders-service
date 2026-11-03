import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/paginated.dto';
import { OrderItem } from '../entities/order-item.entity';
import { Order, OrderStatus } from '../entities/order.entity';

export class OrderItemResponseDto {
  @ApiProperty({ format: 'uuid' })
  productId: string;

  @ApiProperty()
  quantity: number;

  @ApiProperty({ description: 'Price per unit when the order was placed, in cents' })
  unitPriceCents: number;

  static fromEntity(item: OrderItem): OrderItemResponseDto {
    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
    };
  }
}

export class OrderResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty()
  totalCents: number;

  @ApiProperty({ type: [OrderItemResponseDto] })
  items: OrderItemResponseDto[];

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static fromEntity(order: Order, items: OrderItem[] = order.items): OrderResponseDto {
    return {
      id: order.id,
      userId: order.userId,
      status: order.status,
      totalCents: order.totalCents,
      items: [...items]
        .sort((a, b) => a.productId.localeCompare(b.productId))
        .map((item) => OrderItemResponseDto.fromEntity(item)),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}

export class OrderPageDto {
  @ApiProperty({ type: [OrderResponseDto] })
  data: OrderResponseDto[];

  @ApiProperty()
  meta: PaginationMetaDto;
}
