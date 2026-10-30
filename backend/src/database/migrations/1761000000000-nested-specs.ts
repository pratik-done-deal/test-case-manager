import { MigrationInterface, QueryRunner } from 'typeorm';

// specs/ moved to specs/<modules|features>/<role>/<module>/<area…>/: a suite is now known by its file
// path, cases remember which areas (split review files) show them, and folders carry the names and
// statuses from module.yml / feature.yml.
export class NestedSpecs1761000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE suites DROP CONSTRAINT suites_kind_slug_key`);
    await queryRunner.query(`
      ALTER TABLE suites
        ADD COLUMN role text NOT NULL DEFAULT '',
        ADD COLUMN node text NOT NULL DEFAULT '',
        ADD COLUMN setup text NOT NULL DEFAULT ''
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX suites_source ON suites (source)`);
    await queryRunner.query(`ALTER TABLE scenarios DROP CONSTRAINT scenarios_role_key_check`);
    await queryRunner.query(`
      ALTER TABLE scenarios
        ADD COLUMN biz_user boolean NOT NULL DEFAULT false,
        ADD COLUMN feature text
    `);
    await queryRunner.query(`
      ALTER TABLE test_cases
        ADD COLUMN areas jsonb NOT NULL DEFAULT '[]',
        ADD COLUMN feature text
    `);
    await queryRunner.query(`
      CREATE TABLE folders (
        kind text NOT NULL CHECK (kind IN ('feature', 'module')),
        role text NOT NULL,
        path text NOT NULL,
        name text NOT NULL,
        status text,
        req_prefix text,
        PRIMARY KEY (kind, role, path)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE folders`);
    await queryRunner.query(`ALTER TABLE test_cases DROP COLUMN areas, DROP COLUMN feature`);
    await queryRunner.query(`ALTER TABLE scenarios DROP COLUMN biz_user, DROP COLUMN feature`);
    await queryRunner.query(`DROP INDEX suites_source`);
    await queryRunner.query(`ALTER TABLE suites DROP COLUMN role, DROP COLUMN node, DROP COLUMN setup`);
    await queryRunner.query(`ALTER TABLE suites ADD CONSTRAINT suites_kind_slug_key UNIQUE (kind, slug)`);
  }
}
