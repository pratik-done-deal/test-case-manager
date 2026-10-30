import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { api, apiRetry } from './api.mjs';
import { config, pluginEnv } from './config.mjs';

const TICK_MS = 1000;
const KILL_AFTER_MS = 5000;
// Keeps one report under the backend's 20 MB body limit even with several screenshots.
const MAX_BATCH_BYTES = 8 * 1024 * 1024;

// The stop of each run going now, so quitting the agent stops pytest too.
export const executing = new Set();

// Runs one claimed run's tests with ai-qa's pytest and reports to the backend as they go: each test
// as it starts and finishes (with the screenshots ai-qa took), and pytest's output. Stops pytest when
// the backend says Stop was pressed. Resolves when the backend has the run's end.
export function executeRun(runnerId, claimed) {
  const path = `/agent/${runnerId}/runs/${claimed.id}`;
  const scratch = mkdtempSync(join(tmpdir(), 'test-manager-run-'));
  const select = join(scratch, 'select.txt');
  const events = join(scratch, 'events.jsonl');
  writeFileSync(select, claimed.nodeids.join('\n'));
  writeFileSync(events, '');

  // Only the files of the chosen tests are collected; the plugin then keeps just the chosen tests.
  const files = [...new Set(claimed.nodeids.map((nodeid) => nodeid.split('::')[0]))];
  const args = ['-m', 'pytest', '-p', 'test_manager_plugin', ...(claimed.headed ? ['--headed'] : []), ...files];
  console.log(`Run ${claimed.id}: ${claimed.nodeids.length} tests${claimed.headed ? ' (headed)' : ''}`);

  // Its own process group, so Stop also ends the browsers it opened.
  const child = spawn(config.python, args, {
    cwd: config.aiQaDir,
    env: pluginEnv({ TM_SELECT: select, TM_EVENTS_OUT: events }),
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const state = { offset: 0, partial: '', queue: [], log: '', stopping: false, sending: Promise.resolve() };
  const append = (chunk) => {
    state.log += chunk.toString();
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', (error) => append(`\n${error.message}\n`));

  const kill = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  const stop = () => {
    if (state.stopping) return;
    state.stopping = true;
    console.log(`Run ${claimed.id}: stopping`);
    kill('SIGTERM');
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) kill('SIGKILL');
    }, KILL_AFTER_MS).unref();
  };

  // Reads what pytest has written since the last tick into the queue of events to report.
  const read = () => {
    if (!existsSync(events)) return;
    const fd = openSync(events, 'r');
    try {
      const buffer = Buffer.alloc(64 * 1024);
      let n;
      while ((n = readSync(fd, buffer, 0, buffer.length, state.offset)) > 0) {
        state.offset += n;
        state.partial += buffer.subarray(0, n).toString();
      }
    } finally {
      closeSync(fd);
    }
    const lines = state.partial.split('\n');
    state.partial = lines.pop() ?? '';
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.event === 'done') {
        // Read now: the next test, or the next run, may write over ai-qa's copies.
        event.screenshots = (event.screenshots ?? [])
          .filter((shot) => existsSync(shot.path))
          .map((shot) => ({ url: shot.url, name: basename(shot.path), data: readFileSync(shot.path).toString('base64') }));
      }
      state.queue.push(event);
    }
  };

  // Sends the queued events and new output; kept until the backend has them, so a dropped connection
  // loses nothing (the backend ignores a test it already has).
  const send = async () => {
    read();
    if (!state.queue.length && !state.log) return api('POST', `${path}/progress`, { events: [], log: '' });
    let size = 0;
    let count = 0;
    while (count < state.queue.length && (count === 0 || size < MAX_BATCH_BYTES)) {
      size += JSON.stringify(state.queue[count]).length;
      count++;
    }
    const batch = state.queue.slice(0, count);
    const log = state.log;
    const reply = await api('POST', `${path}/progress`, { events: batch, log });
    state.queue.splice(0, count);
    state.log = state.log.slice(log.length);
    return reply;
  };

  const tick = () => {
    state.sending = state.sending
      .then(send)
      .then((reply) => {
        if (reply?.stop) stop();
      })
      .catch((error) => console.warn(`Run ${claimed.id}: could not report progress (${error.message}); will retry`));
    return state.sending;
  };
  const timer = setInterval(tick, TICK_MS);
  executing.add(stop);

  return new Promise((resolve) => {
    child.on('close', async (code) => {
      clearInterval(timer);
      // Everything pytest wrote, sent before the end.
      for (let attempt = 0; attempt < 30; attempt++) {
        await tick();
        read();
        if (!state.queue.length && !state.log) break;
        await new Promise((done) => setTimeout(done, Math.min(30_000, 1000 * 2 ** attempt)));
      }
      try {
        const { status } = await apiRetry('POST', `${path}/finish`, { exitCode: code, stopped: state.stopping }, { attempts: 30, label: `Run ${claimed.id}` });
        console.log(`Run ${claimed.id}: ${status} (exit ${code})`);
      } catch (error) {
        console.error(`Run ${claimed.id}: could not report its end (${error.message})`);
      }
      rmSync(scratch, { recursive: true, force: true });
      resolve();
    });
  }).finally(() => {
    executing.delete(stop);
  });
}
