// The environment a run's results are kept under: the host (and port) of the app the tests point at,
// e.g. "qa.done.deals" or "localhost:3000". null when the runner couldn't tell.
export function environmentKey(appUrl: string | null | undefined): string | null {
  if (!appUrl) return null;
  try {
    return new URL(appUrl).host || null;
  } catch {
    return null;
  }
}

// Where results go when the runner couldn't tell which app its tests point at.
export const UNKNOWN_ENVIRONMENT = 'unknown';
