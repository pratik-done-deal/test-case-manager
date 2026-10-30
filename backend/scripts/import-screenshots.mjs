// Once, after the "deployable" migration: copies the failure screenshots that older runs kept on the
// backend's disk (storage/reports/<run id>/<file>) into the database, where reports now read them.
//
//   DATABASE_URL=postgres://… node scripts/import-screenshots.mjs [path/to/storage/reports]
import 'dotenv/config';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

const dir = resolve(process.argv[2] ?? process.env.REPORTS_DIR ?? 'storage/reports');
if (!existsSync(dir)) {
  console.log(`Nothing to import: no ${dir}`);
  process.exit(0);
}

const contentType = (file) => (/\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.webp$/i.test(file) ? 'image/webp' : 'image/png');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://localhost:5432/test_manager' });
await client.connect();
let imported = 0;
let skipped = 0;
for (const runId of readdirSync(dir)) {
  const folder = join(dir, runId);
  if (!statSync(folder).isDirectory()) continue;
  for (const file of readdirSync(folder)) {
    // Only runs still in the database; a screenshot already there is left as it is.
    const { rowCount } = await client.query(
      `INSERT INTO screenshots (run_id, file, content_type, data)
       SELECT $1::uuid, $2, $3, $4 WHERE EXISTS (SELECT 1 FROM runs WHERE id = $1::uuid)
       ON CONFLICT DO NOTHING`,
      [runId, file, contentType(file), readFileSync(join(folder, file))],
    );
    if (rowCount) imported++;
    else skipped++;
  }
}
await client.end();
console.log(`Imported ${imported} screenshots${skipped ? `; skipped ${skipped} (already there, or their run is gone)` : ''}`);
