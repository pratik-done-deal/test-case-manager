import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1760000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE suites (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        kind text NOT NULL CHECK (kind IN ('feature', 'module')),
        slug text NOT NULL,
        title text NOT NULL,
        status text NOT NULL,
        coverage text NOT NULL,
        source text NOT NULL,
        intro text NOT NULL,
        happy_flow text NOT NULL,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (kind, slug)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE scenarios (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        suite_id uuid NOT NULL REFERENCES suites (id) ON DELETE CASCADE,
        code text NOT NULL,
        title text NOT NULL,
        role text NOT NULL,
        role_key text NOT NULL CHECK (role_key IN ('admin', 'seller', 'buyer', 'biz_user')),
        precondition text NOT NULL,
        path text NOT NULL,
        position int NOT NULL,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX scenarios_suite_id ON scenarios (suite_id)`);
    await queryRunner.query(`
      CREATE TABLE test_cases (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        scenario_id uuid NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
        code text NOT NULL,
        title text NOT NULL,
        given text,
        steps jsonb NOT NULL,
        expected text NOT NULL,
        priority text NOT NULL,
        type text NOT NULL,
        req jsonb NOT NULL,
        run_as text NOT NULL,
        detail text,
        position int NOT NULL,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX test_cases_scenario_id ON test_cases (scenario_id)`);
    await queryRunner.query(`
      CREATE TABLE results (
        test_case_id uuid PRIMARY KEY REFERENCES test_cases (id) ON DELETE CASCADE,
        status text NOT NULL CHECK (status IN ('pass', 'fail')),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE results`);
    await queryRunner.query(`DROP TABLE test_cases`);
    await queryRunner.query(`DROP TABLE scenarios`);
    await queryRunner.query(`DROP TABLE suites`);
  }
}
