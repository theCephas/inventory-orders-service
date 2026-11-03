import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';
import { Order } from './order.entity';

@Entity({ name: 'order_items' })
@Unique('UQ_order_items_order_id_product_id', ['orderId', 'productId'])
@Check('CHK_order_items_quantity_positive', '"quantity" > 0')
@Check('CHK_order_items_unit_price_cents_non_negative', '"unit_price_cents" >= 0')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_order_items_order_id')
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id', foreignKeyConstraintName: 'FK_order_items_order_id' })
  order: Order;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id', foreignKeyConstraintName: 'FK_order_items_product_id' })
  product: Product;

  @Column({ type: 'integer' })
  quantity: number;

  // Snapshot of the product price when the order was placed; later price changes must not alter history.
  @Column({ name: 'unit_price_cents', type: 'integer' })
  unitPriceCents: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
