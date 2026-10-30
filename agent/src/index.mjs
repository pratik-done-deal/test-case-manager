// The Test Manager runner agent: runs on a tester's laptop next to its ai-qa checkout, and does the work
// the deployed app can't do itself. It tells the backend which tests the checkout has, picks up the runs
// queued for this laptop, runs them with ai-qa's pytest and reports as they go, and opens the login
// windows the app asks for.
//
//   cp .env.example .env   # API_URL, RUNNER_TOKEN, AI_QA_DIR
//   npm start
import { api, ApiError, apiRetry } from './api.mjs';
import { watchTests } from './collect.mjs';
import { config } from './config.mjs';
import { readEnvironment } from './environment.mjs';
import { Logins } from './logins.mjs';
import { executeRun, executing } from './run.mjs';

const POLL_MS = 2000;
// Saved sessions can change outside the app (the script run by hand), so they are re-reported now and then.
const LOGINS_EVERY_MS = 30_000;

let runnerId = null;
let busy = false;
let lastLogins = '';

const logins = new Logins(() => void reportLogins());

async function reportLogins(force = false) {
  if (!runnerId) return;
  const state = logins.state();
  const text = JSON.stringify(state);
  if (!force && text === lastLogins) return;
  try {
    await api('PUT', `/agent/${runnerId}/logins`, { logins: state });
    lastLogins = text;
  } catch (error) {
    console.warn(`Could not report the logins: ${error.message}`);
  }
}

async function hello() {
  const environment = await readEnvironment();
  const reply = await apiRetry('POST', '/agent/hello', { name: config.name, environment, logins: logins.state() }, { label: 'Connecting' });
  runnerId = reply.id;
  lastLogins = JSON.stringify(logins.state());
  console.log(`Connected to ${config.apiUrl} as "${config.name}"; tests point at ${environment.appUrl ?? 'an unknown app'}`);
}

async function main() {
  console.log(`ai-qa checkout: ${config.aiQaDir}`);
  await logins.init();
  await hello();

  const tests = watchTests(async ({ tests, reason, environment }) => {
    await apiRetry('PUT', `/agent/${runnerId}/tests`, { tests, reason, environment }, { label: 'Reporting tests' });
  });
  await tests.first;

  setInterval(() => void reportLogins(), LOGINS_EVERY_MS);

  const shutdown = async (signal) => {
    console.log(`${signal}: stopping`);
    tests.stop();
    logins.closeAll();
    for (const stop of executing) stop();
    // Gives a run that was going a moment to report that it stopped.
    setTimeout(() => process.exit(0), executing.size ? 8000 : 0).unref();
    if (!executing.size) process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  for (;;) {
    try {
      const { commands, run } = await api('POST', `/agent/${runnerId}/poll`);
      for (const command of commands) logins.handle(command);
      if (run && !busy) {
        busy = true;
        void executeRun(runnerId, run).finally(() => {
          busy = false;
          void reportLogins(true);
        });
      }
    } catch (error) {
      // The backend no longer knows this runner (its database was reset): register again.
      if (error instanceof ApiError && error.status === 404) {
        await hello();
        await tests.resend();
      } else if (error instanceof ApiError && error.status === 403) {
        console.error('The backend refused RUNNER_TOKEN; check it matches the backend’s RUNNER_TOKEN');
      } else {
        console.warn(`Lost the backend (${error.message}); retrying`);
      }
    }
    await new Promise((done) => setTimeout(done, POLL_MS));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
