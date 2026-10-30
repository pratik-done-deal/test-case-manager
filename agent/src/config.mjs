import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is not set (see agent/.env.example)`);
    process.exit(1);
  }
  return value;
}

const aiQaDir = resolve(root, required('AI_QA_DIR'));
const venvPython =
  process.platform === 'win32' ? join(aiQaDir, '.venv', 'Scripts', 'python.exe') : join(aiQaDir, '.venv', 'bin', 'python');

export const config = {
  apiUrl: required('API_URL').replace(/\/$/, ''),
  token: required('RUNNER_TOKEN'),
  name: process.env.RUNNER_NAME?.trim() || hostname().replace(/\.local$/, ''),
  aiQaDir,
  python: process.env.AI_QA_PYTHON?.trim() ? resolve(root, process.env.AI_QA_PYTHON.trim()) : venvPython,
  // The pytest plugin that reports to the agent; see plugin/test_manager_plugin.py.
  pluginDir: join(root, 'plugin'),
};

// Environment for a pytest process that loads the plugin.
export function pluginEnv(extra) {
  const pythonPath = [config.pluginDir, process.env.PYTHONPATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':');
  return { ...process.env, PYTHONPATH: pythonPath, PYTHONUNBUFFERED: '1', ...extra };
}
