// Once: copies everything from the old Postgres database into the new, empty MySQL one. Postgres is
// only read, never changed. Works from the original Postgres schema (results without environments,
// outcomes inside runs) as well as from the later one with runners.
//
//   1. Start MySQL and create its tables: docker compose up -d db, then npm run build && npm run migrate
//   2. POSTGRES_URL=postgres://localhost:5432/test_manager DATABASE_URL=mysql://… npm run migrate-from-postgres
import 'dotenv/config';
import mysql from 'mysql2/promise';
import pg from 'pg';

const source = process.env.POSTGRES_URL ?? 'postgres://localhost:5432/test_manager';
const target = process.env.DATABASE_URL;
if (!target?.startsWith('mysql://')) {
  console.error('Set DATABASE_URL to the MySQL database (mysql://…)');
  process.exit(1);
}
// Results recorded before environments existed all came from the QA app.
const DEFAULT_ENVIRONMENT = process.env.DEFAULT_ENVIRONMENT ?? 'qa.done.deals';

const pgClient = new pg.Client({ connectionString: source });
await pgClient.connect();
const my = await mysql.createConnection({ uri: target, timezone: 'Z', charset: 'utf8mb4' });

const hasTable = async (table) =>
  (await pgClient.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`, [table])).rowCount > 0;
const hasColumn = async (table, column) =>
  (
    await pgClient.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
      [table, column],
    )
  ).rowCount > 0;

const json = (value) => (value === null || value === undefined ? null : JSON.stringify(value));
const hostOf = (url) => {
  try {
    return url ? new URL(url).host || null : null;
  } catch {
    return null;
  }
};

// Inserts rows in batches; columns in the order given.
async function insert(table, columns, rows) {
  const BATCH = table === 'screenshots' ? 1 : 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const placeholders = batch.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ');
    await my.query(`INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`, batch.flatMap((row) => columns.map((c) => row[c])));
  }
  console.log(`  ${table}: ${rows.length}`);
}

try {
  const [[{ n: existing }]] = await my.query('SELECT COUNT(*) AS n FROM suites');
  if (Number(existing) > 0) {
    console.error('The MySQL database already has test cases; this copy is only for an empty one.');
    process.exit(1);
  }

  console.log(`Copying ${source.replace(/\/\/[^@]*@/, '//')} into MySQL…`);
  await my.beginTransaction();

  const suites = (await pgClient.query('SELECT * FROM suites')).rows;
  await insert('suites', ['id', 'kind', 'role', 'node', 'slug', 'source', 'title', 'status', 'coverage', 'intro', 'happy_flow', 'setup', 'archived_at', 'created_at', 'updated_at'], suites);

  const scenarios = (await pgClient.query('SELECT * FROM scenarios')).rows;
  await insert('scenarios', ['id', 'suite_id', 'code', 'title', 'role', 'role_key', 'biz_user', 'feature', 'precondition', 'path', 'position', 'archived_at', 'created_at', 'updated_at'], scenarios);

  const cases = (await pgClient.query('SELECT * FROM test_cases')).rows.map((row) => ({
    ...row,
    steps: json(row.steps),
    req: json(row.req),
    areas: json(row.areas ?? []),
  }));
  await insert('test_cases', ['id', 'scenario_id', 'code', 'title', 'given', 'steps', 'expected', 'priority', 'type', 'req', 'run_as', 'detail', 'areas', 'feature', 'position', 'archived_at', 'created_at', 'updated_at'], cases);

  const withEnvironments = await hasColumn('results', 'environment');
  const results = (await pgClient.query('SELECT * FROM results')).rows.map((row) => ({
    ...row,
    environment: withEnvironments ? row.environment : DEFAULT_ENVIRONMENT,
    source: row.source ?? 'manual',
  }));
  await insert('results', ['test_case_id', 'environment', 'status', 'source', 'updated_at'], results);

  const folders = (await pgClient.query('SELECT * FROM folders')).rows;
  await insert('folders', ['kind', 'role', 'path', 'name', 'status', 'req_prefix'], folders);

  if (await hasTable('runners')) {
    const runners = (await pgClient.query('SELECT * FROM runners')).rows.map((row) => ({
      ...row,
      environment: json(row.environment),
      tests: json(row.tests ?? []),
      logins: json(row.logins),
      commands: '[]',
    }));
    await insert('runners', ['id', 'name', 'last_seen_at', 'environment', 'tests', 'tests_reason', 'tests_at', 'logins', 'commands', 'created_at'], runners);
  }

  const oldOutcomes = await hasColumn('runs', 'outcomes');
  const runRows = (await pgClient.query('SELECT * FROM runs ORDER BY started_at')).rows;
  const runs = runRows.map((row) => ({
    ...row,
    // A run that was going when Postgres was left can't be followed any more.
    status: row.status === 'running' || row.status === 'queued' ? 'interrupted' : row.status,
    finished_at: row.finished_at ?? (row.status === 'running' || row.status === 'queued' ? row.started_at : null),
    runner_id: row.runner_id ?? null,
    environment_key: row.environment_key ?? hostOf(row.environment?.appUrl),
    stop_requested: row.stop_requested ?? false,
    heartbeat_at: row.heartbeat_at ?? null,
    current_test: null,
    options: json(row.options ?? {}),
    scope: json(row.scope),
    scope_key: row.scope?.key ?? null,
    environment: json(row.environment),
    cases: json(row.cases),
    snapshot: json(row.snapshot ?? {}),
    summary: json(row.summary),
  }));
  await insert('runs', ['id', 'label', 'status', 'runner_id', 'environment_key', 'stop_requested', 'heartbeat_at', 'current_test', 'options', 'scope', 'scope_key', 'environment', 'cases', 'snapshot', 'summary', 'log', 'exit_code', 'started_at', 'finished_at'], runs);

  let runTests;
  if (oldOutcomes) {
    runTests = runRows.flatMap((run) =>
      Object.entries(run.outcomes ?? {}).map(([nodeid, outcome], position) => ({
        run_id: run.id,
        nodeid,
        position,
        outcome: outcome.outcome,
        message: outcome.message ?? null,
        duration: outcome.duration ?? null,
        screenshots: json(outcome.screenshots ?? []),
      })),
    );
  } else {
    runTests = (await pgClient.query('SELECT * FROM run_tests')).rows.map((row) => ({ ...row, screenshots: json(row.screenshots ?? []) }));
  }
  await insert('run_tests', ['run_id', 'nodeid', 'position', 'outcome', 'message', 'duration', 'screenshots'], runTests);

  if (await hasTable('screenshots')) {
    const shots = (await pgClient.query('SELECT * FROM screenshots')).rows;
    await insert('screenshots', ['run_id', 'file', 'content_type', 'data', 'created_at'], shots);
  } else {
    console.log('  screenshots: none in Postgres; copy the old ones from disk with scripts/import-screenshots.mjs');
  }

  await my.commit();
  console.log('Done.');
} catch (error) {
  await my.rollback().catch(() => undefined);
  console.error(`Nothing was copied: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pgClient.end();
  await my.end();
}
