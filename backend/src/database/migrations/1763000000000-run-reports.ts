import { MigrationInterface, QueryRunner } from 'typeorm';

// Every run has a report: what it covered (to compare runs of the same thing), where it ran, the cases
// as they read at the time, and a summary once it ends.
export class RunReports1763000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE runs
        ADD COLUMN scope jsonb,
        ADD COLUMN environment jsonb,
        ADD COLUMN snapshot jsonb NOT NULL DEFAULT '{}',
        ADD COLUMN summary jsonb
    `);
    await queryRunner.query(`CREATE INDEX runs_scope_key ON runs ((scope ->> 'key'), started_at DESC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX runs_scope_key`);
    await queryRunner.query(`ALTER TABLE runs DROP COLUMN scope, DROP COLUMN environment, DROP COLUMN snapshot, DROP COLUMN summary`);
  }
}
