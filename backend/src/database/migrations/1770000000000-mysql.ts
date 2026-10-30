import { MigrationInterface, QueryRunner } from 'typeorm';

// The whole schema on MySQL 8.4. Binary collation keeps text comparisons case-sensitive (node ids,
// file paths, codes), the way they were on Postgres. Times are UTC, to the millisecond.
const TABLE = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin';

export class Mysql1770000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // One markdown file that owns test cases.
    await queryRunner.query(`
      CREATE TABLE suites (
        id char(36) NOT NULL PRIMARY KEY,
        kind varchar(16) NOT NULL CHECK (kind IN ('feature', 'module')),
        role varchar(64) NOT NULL,
        node varchar(500) NOT NULL,
        slug varchar(255) NOT NULL,
        source varchar(512) NOT NULL,
        title text NOT NULL,
        status text NOT NULL,
        coverage text NOT NULL,
        intro mediumtext NOT NULL,
        happy_flow mediumtext NOT NULL,
        setup mediumtext NOT NULL,
        archived_at datetime(3) NULL,
        created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        UNIQUE KEY suites_source (source)
      ) ${TABLE}
    `);
    await queryRunner.query(`
      CREATE TABLE scenarios (
        id char(36) NOT NULL PRIMARY KEY,
        suite_id char(36) NOT NULL,
        code varchar(64) NOT NULL,
        title text NOT NULL,
        role text NOT NULL,
        role_key varchar(64) NOT NULL,
        biz_user boolean NOT NULL DEFAULT false,
        feature varchar(255) NULL,
        precondition mediumtext NOT NULL,
        path mediumtext NOT NULL,
        position int NOT NULL,
        archived_at datetime(3) NULL,
        created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        KEY scenarios_suite_id (suite_id),
        CONSTRAINT scenarios_suite FOREIGN KEY (suite_id) REFERENCES suites (id) ON DELETE CASCADE
      ) ${TABLE}
    `);
    await queryRunner.query(`
      CREATE TABLE test_cases (
        id char(36) NOT NULL PRIMARY KEY,
        scenario_id char(36) NOT NULL,
        code varchar(64) NOT NULL,
        title text NOT NULL,
        given mediumtext NULL,
        steps json NOT NULL,
        expected mediumtext NOT NULL,
        priority varchar(32) NOT NULL,
        type varchar(64) NOT NULL,
        req json NOT NULL,
        run_as text NOT NULL,
        detail mediumtext NULL,
        areas json NOT NULL,
        feature varchar(255) NULL,
        position int NOT NULL,
        archived_at datetime(3) NULL,
        created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        KEY test_cases_scenario_id (scenario_id),
        CONSTRAINT test_cases_scenario FOREIGN KEY (scenario_id) REFERENCES scenarios (id) ON DELETE CASCADE
      ) ${TABLE}
    `);
    // The current pass / fail of a test case on one environment (the app the tests point at).
    await queryRunner.query(`
      CREATE TABLE results (
        test_case_id char(36) NOT NULL,
        environment varchar(200) NOT NULL,
        status varchar(8) NOT NULL CHECK (status IN ('pass', 'fail')),
        source varchar(64) NOT NULL DEFAULT 'manual',
        updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (test_case_id, environment),
        CONSTRAINT results_test_case FOREIGN KEY (test_case_id) REFERENCES test_cases (id) ON DELETE CASCADE
      ) ${TABLE}
    `);
    // A module.yml or feature.yml.
    await queryRunner.query(`
      CREATE TABLE folders (
        kind varchar(16) NOT NULL CHECK (kind IN ('feature', 'module')),
        role varchar(64) NOT NULL,
        path varchar(500) NOT NULL,
        name text NOT NULL,
        status text NULL,
        req_prefix varchar(64) NULL,
        PRIMARY KEY (kind, role, path)
      ) ${TABLE}
    `);

    // The runner agents on testers' laptops.
    await queryRunner.query(`
      CREATE TABLE runners (
        id char(36) NOT NULL PRIMARY KEY,
        name varchar(100) NOT NULL,
        last_seen_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        environment json NULL,
        tests json NOT NULL,
        tests_reason mediumtext NULL,
        tests_at datetime(3) NULL,
        logins json NULL,
        commands json NOT NULL,
        created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY runners_name (name)
      ) ${TABLE}
    `);
    await queryRunner.query(`
      CREATE TABLE runs (
        id char(36) NOT NULL PRIMARY KEY,
        label text NOT NULL,
        status varchar(16) NOT NULL
          CHECK (status IN ('queued', 'running', 'finished', 'stopped', 'error', 'interrupted')),
        runner_id char(36) NULL,
        environment_key varchar(200) NULL,
        stop_requested boolean NOT NULL DEFAULT false,
        heartbeat_at datetime(3) NULL,
        current_test varchar(700) NULL,
        options json NOT NULL,
        scope json NULL,
        scope_key varchar(500) NULL,
        environment json NULL,
        cases json NOT NULL,
        snapshot json NOT NULL,
        summary json NULL,
        log mediumtext NOT NULL,
        exit_code int NULL,
        started_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        finished_at datetime(3) NULL,
        KEY runs_started_at (started_at),
        KEY runs_scope_key (scope_key, started_at),
        KEY runs_runner_status (runner_id, status),
        CONSTRAINT runs_runner FOREIGN KEY (runner_id) REFERENCES runners (id) ON DELETE SET NULL
      ) ${TABLE}
    `);
    await queryRunner.query(`
      CREATE TABLE run_tests (
        run_id char(36) NOT NULL,
        nodeid varchar(700) NOT NULL,
        position int NOT NULL,
        outcome varchar(16) NOT NULL,
        message mediumtext NULL,
        duration double NULL,
        screenshots json NOT NULL,
        PRIMARY KEY (run_id, nodeid),
        CONSTRAINT run_tests_run FOREIGN KEY (run_id) REFERENCES runs (id) ON DELETE CASCADE
      ) ${TABLE}
    `);
    await queryRunner.query(`
      CREATE TABLE screenshots (
        run_id char(36) NOT NULL,
        file varchar(200) NOT NULL,
        content_type varchar(64) NOT NULL,
        data longblob NOT NULL,
        created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        PRIMARY KEY (run_id, file),
        CONSTRAINT screenshots_run FOREIGN KEY (run_id) REFERENCES runs (id) ON DELETE CASCADE
      ) ${TABLE}
    `);

    // Changes every API container reads, so pages connected to any of them hear about them.
    await queryRunner.query(`
      CREATE TABLE change_events (
        id bigint NOT NULL AUTO_INCREMENT PRIMARY KEY,
        event varchar(32) NOT NULL,
        origin char(36) NOT NULL,
        created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        KEY change_events_created_at (created_at)
      ) ${TABLE}
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['change_events', 'screenshots', 'run_tests', 'runs', 'runners', 'folders', 'results', 'test_cases', 'scenarios', 'suites']) {
      await queryRunner.query(`DROP TABLE ${table}`);
    }
  }
}
