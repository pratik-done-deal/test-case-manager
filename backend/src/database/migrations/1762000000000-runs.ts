import { MigrationInterface, QueryRunner } from 'typeorm';

// Test cases can be run from the app: each pytest run it starts is kept, with its tests' outcomes.
export class Runs1762000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE runs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        label text NOT NULL,
        status text NOT NULL CHECK (status IN ('running', 'finished', 'stopped', 'error', 'interrupted')),
        options jsonb NOT NULL DEFAULT '{}',
        cases jsonb NOT NULL,
        outcomes jsonb NOT NULL DEFAULT '{}',
        log text NOT NULL DEFAULT '',
        exit_code int,
        started_at timestamptz NOT NULL DEFAULT now(),
        finished_at timestamptz
      )
    `);
    await queryRunner.query(`CREATE INDEX runs_started_at ON runs (started_at DESC)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE runs`);
  }
}
