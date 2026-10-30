import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { existsSync, FSWatcher, readdirSync, readFileSync, watch } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { SyncService, type SpecFile } from './sync.service';

const DEBOUNCE_MS = 300;
// A full re-read now and then catches any change the file watcher missed.
const RESYNC_MS = 5 * 60_000;

// Whether a watch event can change the test cases: a .md or .yml file, or a name with no extension,
// which is a folder (renaming or moving one reports only the folder, not the files in it).
export function touches(file: string | null, extensions: RegExp) {
  if (!file) return true;
  const name = file.split(/[\\/]/).pop() ?? '';
  return extensions.test(name) || !name.includes('.');
}

const TC_TABLE = /^\| TC \|/m;

// What the sync needs from specs/: every test-cases.md, any other .md holding a test case table (a
// split review file), and the module.yml / feature.yml files that name the folders.
export function readSpecFiles(specsDir: string): SpecFile[] {
  const files: SpecFile[] = [];
  const walk = (dir: string) => {
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
  return files;
}

// When SPECS_DIR is set (the specs folder is on this machine), syncs it on start and again whenever
// a test case file or folder in it changes, so a new test case is in the app the moment it is written;
// and every few minutes in case a change was missed.
@Injectable()
export class SpecsWatcher implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SpecsWatcher.name);
  private watcher?: FSWatcher;
  private timer?: NodeJS.Timeout;
  private resync?: NodeJS.Timeout;

  constructor(private readonly syncService: SyncService) {}

  async onApplicationBootstrap() {
    if (!process.env.SPECS_DIR) return;
    const dir = resolve(process.env.SPECS_DIR);
    if (!existsSync(dir)) {
      this.logger.error(`SPECS_DIR ${dir} does not exist; not syncing from files`);
      return;
    }
    await this.syncFrom(dir);
    this.watchFolder(dir);
    this.resync = setInterval(() => {
      // A watcher that stopped (the folder was removed and came back) is started again.
      if (!this.watcher && existsSync(dir)) this.watchFolder(dir);
      void this.syncFrom(dir, true);
    }, RESYNC_MS);
  }

  onModuleDestroy() {
    clearTimeout(this.timer);
    clearInterval(this.resync);
    this.watcher?.close();
  }

  private watchFolder(dir: string) {
    this.watcher = watch(dir, { recursive: true }, (_event, file) => {
      if (!touches(file, /\.(md|yml)$/)) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => void this.syncFrom(dir), DEBOUNCE_MS);
    });
    this.watcher.on('error', (error) => {
      this.logger.error(`Stopped watching ${dir}: ${error.message}; checking again every few minutes`);
      this.watcher?.close();
      this.watcher = undefined;
    });
    this.logger.log(`Watching ${dir}`);
  }

  // quiet: the periodic check, which only logs when it found something the watcher missed.
  private async syncFrom(dir: string, quiet = false) {
    try {
      const files = readSpecFiles(dir);
      // An empty folder is far more likely a wrong path than every test case being removed.
      if (!files.length) {
        this.logger.warn(`No test-cases.md under ${dir}; nothing synced`);
        return;
      }
      const { warnings, ...counts } = await this.syncService.sync(files);
      if (quiet && !(counts.added || counts.renumbered || counts.restored || counts.archived)) return;
      this.logger.log(`Synced ${JSON.stringify(counts)}`);
      for (const warning of warnings) this.logger.warn(warning);
    } catch (error) {
      this.logger.error('Sync failed', error instanceof Error ? error.stack : String(error));
    }
  }
}
