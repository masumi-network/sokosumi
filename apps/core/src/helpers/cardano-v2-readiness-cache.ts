/**
 * Process-local memo for the Cardano V2 rail readiness lookup.
 *
 * Readiness is read on every catalog request (agent list, agent detail,
 * reviews, categories) and on every hire, but it only changes when the
 * agents-sync cron refreshes it — every five minutes. Re-reading `syncMetadata`
 * (and re-parsing its JSON payload) per request buys nothing.
 *
 * The TTL is deliberately far below both the cron cadence and the 30-minute
 * fail-closed staleness window, so the cache can only ever delay a readiness
 * change by a few seconds; it cannot keep a stale-but-valid-looking value alive
 * past that window.
 *
 * Kept in its own module — with no Prisma import — so tests can reset it from
 * the shared setup file without pulling the database client into every suite.
 */
export const CARDANO_V2_READY_SOURCES_CACHE_TTL_MS = 15_000;

interface CachedReadySources<T> {
  value: T[];
  expiresAt: number;
}

let cache: CachedReadySources<unknown> | null = null;

export function getCachedCardanoV2ReadySources<T>(): T[] | null {
  if (!cache || cache.expiresAt <= Date.now()) {
    return null;
  }
  return cache.value as T[];
}

export function setCachedCardanoV2ReadySources<T>(value: T[]): void {
  cache = {
    value,
    expiresAt: Date.now() + CARDANO_V2_READY_SOURCES_CACHE_TTL_MS,
  };
}

/** Drops the memo. Used by tests and after a readiness refresh. */
export function resetCardanoV2ReadySourcesCache(): void {
  cache = null;
}
