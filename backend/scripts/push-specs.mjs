// Sends the test case files under specs/ to a backend that cannot see the specs
// folder itself (a deployed one). The backend parses them and updates its database.
//
//   API_URL=https://… SYNC_TOKEN=… node scripts/push-specs.mjs [path/to/specs]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const specsDir = resolve(process.argv[2] ?? process.env.SPECS_DIR ?? '../../ai-qa/specs');
const apiUrl = (process.env.API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');
const token = process.env.SYNC_TOKEN;

if (!token) {
  console.error('SYNC_TOKEN is not set');
  process.exit(1);
}

// The same files the backend reads from a local SPECS_DIR (src/sync/specs-watcher.service.ts).
const TC_TABLE = /^\| TC \|/m;
const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    const isYml = entry.name === 'module.yml' || entry.name === 'feature.yml';
    if (!isYml && !entry.name.endsWith('.md')) continue;
    const content = readFileSync(full, 'utf8');
    if (isYml || entry.name === 'test-cases.md' || TC_TABLE.test(content)) {
      files.push({ path: `specs/${relative(specsDir, full).split(sep).join('/')}`, content });
    }
  }
};
for (const folder of ['modules', 'features']) {
  if (existsSync(join(specsDir, folder))) walk(join(specsDir, folder));
}
if (!files.length) {
  console.error(`No test-cases.md files under ${specsDir}`);
  process.exit(1);
}

const response = await fetch(`${apiUrl}/sync`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-sync-token': token },
  body: JSON.stringify({ files }),
});
const body = await response.text();
if (!response.ok) {
  console.error(`Sync failed (${response.status}): ${body}`);
  process.exit(1);
}
const { warnings, ...counts } = JSON.parse(body);
console.log(`Synced ${files.length} files:`, counts);
for (const warning of warnings) console.warn(`warning: ${warning}`);
