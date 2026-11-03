import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthUser } from '../auth/auth-user';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Paginated } from '../common/dto/paginated.dto';
import { UserRole } from '../users/entities/user.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ProductPageDto, ProductResponseDto } from './dto/product-response.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOkResponse({ type: ProductPageDto })
  listProducts(
    @Query() query: ListProductsQueryDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Paginated<ProductResponseDto>> {
    return this.productsService.listProducts(query, user.role === UserRole.Admin);
  }

  @Get(':id')
  @ApiOkResponse({ type: ProductResponseDto })
  getProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ProductResponseDto> {
    return this.productsService.getProduct(id, user.role === UserRole.Admin);
  }

  @Post()
  @ApiCreatedResponse({ type: ProductResponseDto })
  @Roles(UserRole.Admin)
  createProduct(@Body() dto: CreateProductDto): Promise<ProductResponseDto> {
    return this.productsService.createProduct(dto);
  }

  @Patch(':id')
  @ApiOkResponse({ type: ProductResponseDto })
  @Roles(UserRole.Admin)
  updateProduct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.updateProduct(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.Admin)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse({ description: 'Soft deleted' })
  deleteProduct(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.productsService.deactivateProduct(id);
  }
}
