import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Grants the reporting service's role read access to exactly the tables it reports on (never
 * `users`). The login role itself is created with its password by the postgres init script; it
 * is only created here, without login, if missing (e.g. in the test database's cluster).
 */
export class ReportingReadOnlyAccess1793700000000 implements MigrationInterface {
  name = 'ReportingReadOnlyAccess1793700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'reporting_reader') THEN
          CREATE ROLE reporting_reader NOLOGIN;
        END IF;
      END
      $$
    `);
    await queryRunner.query(`GRANT USAGE ON SCHEMA public TO reporting_reader`);
    await queryRunner.query(`GRANT SELECT ON orders, order_items, products TO reporting_reader`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The role is cluster-wide and may be used by other databases, so only the grants are revoked.
    await queryRunner.query(`REVOKE SELECT ON orders, order_items, products FROM reporting_reader`);
    await queryRunner.query(`REVOKE USAGE ON SCHEMA public FROM reporting_reader`);
  }
}
