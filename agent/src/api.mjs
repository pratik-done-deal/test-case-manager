import { config } from './config.mjs';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// One call to the Test Manager API, as this runner.
export async function api(method, path, body) {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-runner-token': config.token },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try {
      message = JSON.parse(text).message ?? text;
    } catch {}
    throw new ApiError(response.status, `${method} ${path}: ${response.status} ${message}`);
  }
  return text ? JSON.parse(text) : null;
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

// Keeps trying while the API is unreachable or failing; gives up on a refusal (4xx), which retrying won't fix.
export async function apiRetry(method, path, body, { attempts = Infinity, label = path } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await api(method, path, body);
    } catch (error) {
      const refused = error instanceof ApiError && error.status >= 400 && error.status < 500;
      if (refused || attempt >= attempts) throw error;
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt - 1, 5));
      if (attempt === 1 || attempt % 5 === 0) console.warn(`${label}: ${error.message}; trying again`);
      await wait(delay);
    }
  }
}
