import { execFile } from 'node:child_process';
import { config } from './config.mjs';

const run = (command, args) =>
  new Promise((done) =>
    execFile(command, args, { cwd: config.aiQaDir, timeout: 10_000 }, (error, stdout) => done(error ? null : stdout.trim())),
  );

// The app ai-qa's settings point the tests at, and the branch and commit of the checkout.
export async function readEnvironment() {
  const [appUrl, branch, commit, changes] = await Promise.all([
    run(config.python, ['-c', 'from config import settings; print(settings.app_url)']),
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
    run('git', ['rev-parse', '--short', 'HEAD']),
    run('git', ['status', '--porcelain']),
  ]);
  return {
    appUrl: appUrl?.split('\n').pop() ?? null,
    branch,
    commit,
    dirty: Boolean(changes),
  };
}
