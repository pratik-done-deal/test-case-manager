import { MigrationInterface, QueryRunner } from 'typeorm';

// The backend no longer runs tests itself: a runner agent on a tester's laptop claims queued runs and
// reports back. Runners are kept with the tests they collected and their saved logins; each test's
// outcome is its own row instead of a growing JSON; screenshots are stored in the database instead of
// on the backend's disk; and results are kept per environment (the app the tests point at).
export class Deployable1764000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE runners (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL UNIQUE,
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        environment jsonb,
        tests jsonb NOT NULL DEFAULT '[]',
        tests_reason text,
        tests_at timestamptz,
        logins jsonb,
        commands jsonb NOT NULL DEFAULT '[]',
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`ALTER TABLE runs DROP CONSTRAINT runs_status_check`);
    await queryRunner.query(`
      ALTER TABLE runs
        ADD CONSTRAINT runs_status_check
          CHECK (status IN ('queued', 'running', 'finished', 'stopped', 'error', 'interrupted')),
        ADD COLUMN runner_id uuid REFERENCES runners (id) ON DELETE SET NULL,
        ADD COLUMN environment_key text,
        ADD COLUMN stop_requested boolean NOT NULL DEFAULT false,
        ADD COLUMN heartbeat_at timestamptz,
        ADD COLUMN current_test text
    `);
    await queryRunner.query(`CREATE INDEX runs_runner_status ON runs (runner_id, status)`);
    // Every past run ran against the app its environment names.
    await queryRunner.query(`
      UPDATE runs SET environment_key = substring(environment ->> 'appUrl' from '^[a-z]+://([^/]+)')
      WHERE environment ->> 'appUrl' IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE run_tests (
        run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
        nodeid text NOT NULL,
        position int NOT NULL,
        outcome text NOT NULL,
        message text,
        duration real,
        screenshots jsonb NOT NULL DEFAULT '[]',
        PRIMARY KEY (run_id, nodeid)
      )
    `);
    // jsonb keeps no key order, so the old outcomes are numbered by node id.
    await queryRunner.query(`
      INSERT INTO run_tests (run_id, nodeid, position, outcome, message, duration, screenshots)
      SELECT runs.id, entry.key,
             (row_number() OVER (PARTITION BY runs.id ORDER BY entry.key))::int - 1,
             entry.value ->> 'outcome',
             entry.value ->> 'message',
             (entry.value ->> 'duration')::real,
             coalesce(entry.value -> 'screenshots', '[]')
      FROM runs, jsonb_each(runs.outcomes) AS entry
    `);
    await queryRunner.query(`ALTER TABLE runs DROP COLUMN outcomes`);

    await queryRunner.query(`
      CREATE TABLE screenshots (
        run_id uuid NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
        file text NOT NULL,
        content_type text NOT NULL,
        data bytea NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (run_id, file)
      )
    `);

    // Results so far all came from the QA app, the only one past runs recorded.
    await queryRunner.query(`ALTER TABLE results DROP CONSTRAINT results_pkey`);
    await queryRunner.query(`
      ALTER TABLE results
        ADD COLUMN environment text NOT NULL DEFAULT 'qa.done.deals',
        ADD COLUMN source text NOT NULL DEFAULT 'manual'
    `);
    await queryRunner.query(`ALTER TABLE results ALTER COLUMN environment DROP DEFAULT`);
    await queryRunner.query(`ALTER TABLE results ADD PRIMARY KEY (test_case_id, environment)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Keeps one result per case: the latest, whatever its environment.
    await queryRunner.query(`
      DELETE FROM results r USING results newer
      WHERE r.test_case_id = newer.test_case_id AND r.updated_at < newer.updated_at
    `);
    await queryRunner.query(`ALTER TABLE results DROP CONSTRAINT results_pkey`);
    await queryRunner.query(`ALTER TABLE results DROP COLUMN environment, DROP COLUMN source`);
    await queryRunner.query(`ALTER TABLE results ADD PRIMARY KEY (test_case_id)`);

    await queryRunner.query(`DROP TABLE screenshots`);

    await queryRunner.query(`ALTER TABLE runs ADD COLUMN outcomes jsonb NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`
      UPDATE runs SET outcomes = grouped.outcomes
      FROM (
        SELECT run_id, jsonb_object_agg(nodeid, jsonb_strip_nulls(jsonb_build_object(
          'outcome', outcome, 'message', message, 'duration', duration,
          'screenshots', CASE WHEN screenshots = '[]' THEN NULL ELSE screenshots END))) AS outcomes
        FROM run_tests GROUP BY run_id
      ) grouped
      WHERE runs.id = grouped.run_id
    `);
    await queryRunner.query(`DROP TABLE run_tests`);

    await queryRunner.query(`UPDATE runs SET status = 'stopped' WHERE status = 'queued'`);
    await queryRunner.query(`DROP INDEX runs_runner_status`);
    await queryRunner.query(`ALTER TABLE runs DROP CONSTRAINT runs_status_check`);
    await queryRunner.query(`
      ALTER TABLE runs
        DROP COLUMN runner_id, DROP COLUMN environment_key, DROP COLUMN stop_requested, DROP COLUMN heartbeat_at,
        DROP COLUMN current_test,
        ADD CONSTRAINT runs_status_check CHECK (status IN ('running', 'finished', 'stopped', 'error', 'interrupted'))
    `);
    await queryRunner.query(`DROP TABLE runners`);
  }
}
