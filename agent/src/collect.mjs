import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config, pluginEnv } from './config.mjs';
import { readEnvironment } from './environment.mjs';

const DEBOUNCE_MS = 1000;
// Tests are collected again now and then, in case the file watcher missed a change.
const RECOLLECT_MS = 5 * 60_000;

// Every test in the ai-qa checkout (node id, file, name, docstrings, markers), or why they couldn't be listed.
export async function collectTests() {
  if (!existsSync(join(config.aiQaDir, 'test_cases'))) {
    return { tests: [], reason: `No test_cases folder in ${config.aiQaDir} (check AI_QA_DIR)` };
  }
  if (!existsSync(config.python)) return { tests: [], reason: `No Python at ${config.python} (set AI_QA_PYTHON)` };
  const scratch = mkdtempSync(join(tmpdir(), 'test-manager-collect-'));
  const out = join(scratch, 'tests.json');
  try {
    // addopts is cleared so collecting doesn't wipe ai-qa's last HTML and Allure reports.
    await new Promise((done, fail) =>
      execFile(
        config.python,
        ['-m', 'pytest', '--collect-only', '-q', '-p', 'test_manager_plugin', '-o', 'addopts='],
        { cwd: config.aiQaDir, env: pluginEnv({ TM_COLLECT_OUT: out }), maxBuffer: 64 * 1024 * 1024 },
        (error, _stdout, stderr) => {
          if (existsSync(out)) done();
          else fail(new Error(`pytest could not collect the tests: ${stderr.trim() || error?.message}`));
        },
      ),
    );
    return { tests: JSON.parse(readFileSync(out, 'utf8')), reason: null };
  } catch (error) {
    return { tests: [], reason: error instanceof Error ? error.message : String(error) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// Whether a watch event can change the tests: a .py file, or a name with no extension, which is a folder
// (renaming or moving one reports only the folder, not the files in it).
function touches(file) {
  if (!file) return true;
  if (file.includes('__pycache__')) return false;
  const name = file.split(/[\\/]/).pop() ?? '';
  return name.endsWith('.py') || !name.includes('.');
}

// Collects on start, whenever a test file changes and every few minutes, and calls onChange with what it
// found, and the checkout's branch and app, only when that differs from last time (the backend then
// matches tests to test cases again).
export function watchTests(onChange) {
  let last = null;
  let timer;
  let collecting = Promise.resolve();
  let watcher;

  const refresh = () => {
    collecting = collecting
      .then(async () => {
        const found = { ...(await collectTests()), environment: await readEnvironment() };
        const hash = createHash('sha1').update(JSON.stringify(found)).digest('hex');
        if (hash === last) return;
        if (found.reason) console.error(found.reason);
        else console.log(`Collected ${found.tests.length} tests`);
        await onChange(found);
        last = hash;
      })
      .catch((error) => console.error(`Could not report the tests: ${error.message}`));
    return collecting;
  };

  const folder = join(config.aiQaDir, 'test_cases');
  const startWatching = () => {
    if (watcher || !existsSync(folder)) return;
    watcher = watch(folder, { recursive: true }, (_event, file) => {
      if (!touches(file)) return;
      clearTimeout(timer);
      timer = setTimeout(refresh, DEBOUNCE_MS);
    });
    watcher.on('error', (error) => {
      console.error(`Stopped watching ${folder}: ${error.message}; checking again every few minutes`);
      watcher?.close();
      watcher = undefined;
    });
  };

  startWatching();
  const interval = setInterval(() => {
    startWatching();
    void refresh();
  }, RECOLLECT_MS);

  return {
    first: refresh(),
    // A collection that runs again even if nothing changed, e.g. after the backend forgot this runner.
    resend: () => {
      last = null;
      return refresh();
    },
    stop: () => {
      clearTimeout(timer);
      clearInterval(interval);
      watcher?.close();
    },
  };
}
