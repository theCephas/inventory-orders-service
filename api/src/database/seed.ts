import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { BCRYPT_ROUNDS } from '../auth/auth.service';
import { Product } from '../products/entities/product.entity';
import { User, UserRole } from '../users/entities/user.entity';

export interface SeedAdmin {
  email: string;
  password: string;
}

const SAMPLE_PRODUCTS: Array<
  Pick<Product, 'sku' | 'name' | 'description' | 'priceCents' | 'stockQuantity'>
> = [
  {
    sku: 'KB-001',
    name: 'Mechanical Keyboard',
    description: 'Tenkeyless, brown switches',
    priceCents: 8999,
    stockQuantity: 25,
  },
  {
    sku: 'MS-001',
    name: 'Wireless Mouse',
    description: 'Ergonomic, 2.4 GHz',
    priceCents: 2999,
    stockQuantity: 50,
  },
  {
    sku: 'MN-001',
    name: '27" Monitor',
    description: '1440p IPS panel',
    priceCents: 27999,
    stockQuantity: 10,
  },
  { sku: 'HS-001', name: 'USB Headset', description: null, priceCents: 4999, stockQuantity: 30 },
  {
    sku: 'CB-001',
    name: 'USB-C Cable',
    description: '1 m, braided',
    priceCents: 999,
    stockQuantity: 200,
  },
];

/** Idempotent: existing rows (matched by email / sku) are left untouched. */
export async function seedDatabase(dataSource: DataSource, admin: SeedAdmin): Promise<void> {
  await dataSource
    .createQueryBuilder()
    .insert()
    .into(User)
    .values({
      email: admin.email.trim().toLowerCase(),
      passwordHash: await bcrypt.hash(admin.password, BCRYPT_ROUNDS),
      role: UserRole.Admin,
    })
    .orIgnore()
    .execute();

  await dataSource
    .createQueryBuilder()
    .insert()
    .into(Product)
    .values(SAMPLE_PRODUCTS)
    .orIgnore()
    .execute();
}

async function main(): Promise<void> {
  // Imported lazily so that importing seedDatabase (e.g. from tests) does not require DATABASE_URL.
  const { default: dataSource } = await import('./data-source');
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password || password.length < 8) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 8 chars) must be set');
  }

  await dataSource.initialize();
  try {
    await seedDatabase(dataSource, { email, password });
    console.log(`Seeded admin ${email} and ${SAMPLE_PRODUCTS.length} sample products`);
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
