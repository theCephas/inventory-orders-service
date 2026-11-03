import { DataSourceOptions } from 'typeorm';
import { Order } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Product } from '../products/entities/product.entity';
import { User } from '../users/entities/user.entity';
import { InitialSchema1793692236000 } from './migrations/1793692236000-InitialSchema';

// Shared by the Nest app, the TypeORM CLI, the seed script and the e2e setup so they never drift.
export function buildDataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: [User, Product, Order, OrderItem],
    migrations: [InitialSchema1793692236000],
    synchronize: false,
  };
}
