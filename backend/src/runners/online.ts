// A runner polls every couple of seconds; one not heard from for this long is offline.
export const ONLINE_MS = 15_000;

export const isOnline = (runner: { lastSeenAt: Date }) => Date.now() - runner.lastSeenAt.getTime() < ONLINE_MS;
