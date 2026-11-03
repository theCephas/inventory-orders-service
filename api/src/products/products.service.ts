import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { Paginated } from '../common/dto/paginated.dto';
import { PgErrorCode, pgErrorCode } from '../database/pg-error-codes';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from './entities/product.entity';

@Injectable()
export class ProductsService {
  constructor(@InjectRepository(Product) private readonly products: Repository<Product>) {}

  async listProducts(
    query: ListProductsQueryDto,
    canSeeInactive: boolean,
  ): Promise<Paginated<ProductResponseDto>> {
    const where: FindOptionsWhere<Product> =
      canSeeInactive && query.includeInactive ? {} : { isActive: true };
    const [products, total] = await this.products.findAndCount({
      where,
      // id breaks ties so pages stay stable when names repeat.
      order: { name: 'ASC', id: 'ASC' },
      skip: query.skip,
      take: query.limit,
    });
    return {
      data: products.map((product) => ProductResponseDto.fromEntity(product)),
      meta: { page: query.page, limit: query.limit, total },
    };
  }

  async getProduct(id: string, canSeeInactive: boolean): Promise<ProductResponseDto> {
    return ProductResponseDto.fromEntity(await this.findOrFail(id, canSeeInactive));
  }

  async createProduct(dto: CreateProductDto): Promise<ProductResponseDto> {
    const product = await this.saveHandlingDuplicateSku(this.products.create(dto));
    return ProductResponseDto.fromEntity(product);
  }

  async updateProduct(id: string, dto: UpdateProductDto): Promise<ProductResponseDto> {
    const product = await this.findOrFail(id, true);
    this.products.merge(product, dto);
    return ProductResponseDto.fromEntity(await this.saveHandlingDuplicateSku(product));
  }

  /** Soft delete: order history references products, so rows are deactivated, never removed. */
  async deactivateProduct(id: string): Promise<void> {
    const result = await this.products.update({ id }, { isActive: false });
    if (result.affected === 0) {
      throw new NotFoundException(`Product ${id} not found`);
    }
  }

  private async findOrFail(id: string, canSeeInactive: boolean): Promise<Product> {
    const product = await this.products.findOneBy(canSeeInactive ? { id } : { id, isActive: true });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  private async saveHandlingDuplicateSku(product: Product): Promise<Product> {
    try {
      return await this.products.save(product);
    } catch (error) {
      if (pgErrorCode(error) === PgErrorCode.UniqueViolation) {
        throw new ConflictException(`A product with SKU ${product.sku} already exists`);
      }
      throw error;
    }
  }
}
