import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

// Postgres `integer` upper bound; larger values would fail in the database instead of validation.
export const MAX_INT32 = 2_147_483_647;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateProductDto {
  @ApiProperty({ example: 'KB-002' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  sku: string;

  @ApiProperty({ example: 'Compact Keyboard' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiPropertyOptional({ nullable: true, example: '60% layout, red switches' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiProperty({ description: 'Price in minor units (cents)', example: 7999, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(MAX_INT32)
  priceCents: number;

  @ApiProperty({ example: 15, minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(MAX_INT32)
  stockQuantity: number;
}
