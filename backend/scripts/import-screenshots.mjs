// Once, after moving to MySQL: copies the failure screenshots that older runs kept on the backend's
// disk (storage/reports/<run id>/<file>) into the database, where reports now read them.
//
//   DATABASE_URL=mysql://… node scripts/import-screenshots.mjs [path/to/storage/reports]
import 'dotenv/config';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import mysql from 'mysql2/promise';

const dir = resolve(process.argv[2] ?? process.env.REPORTS_DIR ?? 'storage/reports');
if (!existsSync(dir)) {
  console.log(`Nothing to import: no ${dir}`);
  process.exit(0);
}

const contentType = (file) => (/\.jpe?g$/i.test(file) ? 'image/jpeg' : /\.webp$/i.test(file) ? 'image/webp' : 'image/png');
const db = await mysql.createConnection({ uri: process.env.DATABASE_URL, timezone: 'Z' });
let imported = 0;
let skipped = 0;
for (const runId of readdirSync(dir)) {
  const folder = join(dir, runId);
  if (!statSync(folder).isDirectory()) continue;
  for (const file of readdirSync(folder)) {
    // Only runs still in the database; a screenshot already there is left as it is.
    const [result] = await db.query(
      `INSERT IGNORE INTO screenshots (run_id, file, content_type, data)
       SELECT ?, ?, ?, ? FROM DUAL WHERE EXISTS (SELECT 1 FROM runs WHERE id = ?)`,
      [runId, file, contentType(file), readFileSync(join(folder, file)), runId],
    );
    if (result.affectedRows) imported++;
    else skipped++;
  }
}
await db.end();
console.log(`Imported ${imported} screenshots${skipped ? `; skipped ${skipped} (already there, or their run is gone)` : ''}`);
