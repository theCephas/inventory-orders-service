import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { OrderItem } from './order-item.entity';

export enum OrderStatus {
  Pending = 'pending',
  Confirmed = 'confirmed',
  Shipped = 'shipped',
  Cancelled = 'cancelled',
}

@Entity({ name: 'orders' })
@Check('CHK_orders_total_cents_non_negative', '"total_cents" >= 0')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_orders_user_id')
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_orders_user_id' })
  user: User;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    enumName: 'order_status',
    default: OrderStatus.Pending,
  })
  status: OrderStatus;

  @Column({ name: 'total_cents', type: 'integer' })
  totalCents: number;

  @OneToMany(() => OrderItem, (item) => item.order)
  items: OrderItem[];

  @Index('IDX_orders_created_at')
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
