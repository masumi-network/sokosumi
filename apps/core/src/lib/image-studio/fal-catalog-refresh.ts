import { getEnv } from "@/config/env";
import { getRedisClient } from "@/lib/redis";

import { setResolvedImageCatalog } from "./catalog";
import {
  fetchFalCatalogSources,
  normaliseFalCatalog,
} from "./fal-catalog-fetch";
import type { ImageModel } from "./image-model";

/**
 * Keeping the resolved catalog current, without ever making anybody wait for it.
 *
 * Three layers, each answering a different failure:
 *
 * - **The committed snapshot** (in `catalog.ts`) means a cold instance already
 *   has every model. Nothing here has to succeed for the studio to work.
 * - **A shared Redis entry** means the instances do not each crawl fal. Twenty
 *   instances rolling at once is twenty full catalog crawls, which is how a
 *   deploy earns a rate limit.
 * - **An in-process TTL** means one instance reads that entry at most once every
 *   six hours, whatever the request rate.
 *
 * **Nothing here crawls fal from a request path, and that is the point.** It used
 * to: `ensureImageCatalogFresh` started a detached crawl on a cache miss, on the
 * theory that the snapshot answers the request anyway. On preview that produced
 * `[image-studio] catalog refresh failed { error: 'The operation was aborted due
 * to timeout' }` on every cold start and never once populated Redis — a crawl is
 * ~210 provider reads, paced, with a backoff ladder up to a minute, and a
 * serverless invocation ends when its request does. So every attempt was
 * guaranteed waste that logged like an incident, and the layer it was supposed to
 * fill stayed empty.
 *
 * The crawl now has exactly two callers, both of which own a whole process:
 * `scripts/refresh-fal-catalog.mts` (which rewrites the committed snapshot) and
 * `GET /sync/image-catalog` (cron, which fills Redis). Vercel runs crons on
 * production only, so a preview serves the committed snapshot for its whole life.
 * That is the intended behaviour, not a degraded mode.
 *
 * The one rule is unchanged: a refresh failure logs and keeps serving the last
 * good catalog. No path here empties the studio.
 */

/** fal's catalog moves on the scale of days; six hours is ample. */
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

/** Versioned so a shape change cannot be read back as the old shape. */
const REDIS_KEY = "image-studio:fal-catalog:v1";

interface SharedCatalogEntry {
  fetchedAt: string;
  models: ImageModel[];
}

/** When the in-process copy stops being trusted. Zero means "never refreshed". */
let freshUntil = 0;
/** One crawl at a time per instance, however many callers arrive. */
let inFlight: Promise<void> | null = null;

function markFresh(): void {
  freshUntil = Date.now() + CATALOG_TTL_MS;
}

/**
 * Adopt a catalog a scheduled refresh has shared, if there is one.
 *
 * Safe to await from a request handler, and cheap by construction: one Redis read
 * at most once every six hours per instance, and nothing else. It will not crawl
 * fal — see the note at the top of this file — so a miss is not a failure, it just
 * means this instance keeps serving what it already has.
 */
export async function ensureImageCatalogFresh(): Promise<void> {
  if (Date.now() < freshUntil) return;
  // Marked first: a miss must not make the next request read Redis again, and an
  // unreachable Redis must not turn every page load into a failed connection.
  markFresh();

  const shared = await readSharedCatalog();
  if (shared) setResolvedImageCatalog(shared.models, shared.fetchedAt);
}

/**
 * Crawl fal, adopt the result, and share it through Redis.
 *
 * Minutes of wall clock, so only a caller that owns a whole process may call it:
 * the refresh script, the cron sync route, or a test. Resolves either way — the
 * boolean says whether the catalog moved, and a false is a logged non-event, not
 * an error the caller has to handle.
 *
 * `shouldContinue` lets the cron stop a crawl inside its own budget. A crawl cut
 * short throws rather than returning what it has: a partial catalog is a catalog
 * missing models, and adopting one would take working models out of the composer.
 */
export async function refreshImageCatalog(options?: {
  shouldContinue?: () => boolean;
}): Promise<boolean> {
  if (inFlight) {
    await inFlight;
    return false;
  }
  let outcome = false;
  inFlight = (async () => {
    try {
      const apiKey = getEnv().FAL_KEY;
      if (!apiKey) {
        // Not an incident: a deployment without a key still serves the snapshot,
        // and generation would already have failed long before this mattered.
        markFresh();
        return;
      }
      const sources = await fetchFalCatalogSources({
        fetchImpl: fetch,
        apiKey,
        shouldContinue: options?.shouldContinue,
      });
      const { models, exclusions } = normaliseFalCatalog(sources);
      if (!setResolvedImageCatalog(models, sources.fetchedAt)) {
        console.warn(
          "[image-studio] catalog refresh produced no usable models; keeping the previous catalog",
          { excluded: exclusions.length },
        );
        return;
      }
      await writeSharedCatalog({ fetchedAt: sources.fetchedAt, models });
      outcome = true;
      console.info("[image-studio] catalog refreshed from fal", {
        models: models.length,
        excluded: exclusions.length,
      });
    } catch (error) {
      // The last good catalog stays in place. Backing off for the full TTL is
      // deliberate: fal answering 429 is a reason to stop asking, not to retry
      // on the next page load.
      console.warn("[image-studio] catalog refresh failed", {
        error: error instanceof Error ? error.message : "unknown",
      });
    } finally {
      markFresh();
      inFlight = null;
    }
  })();
  await inFlight;
  return outcome;
}

async function readSharedCatalog(): Promise<SharedCatalogEntry | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  try {
    const raw = await redis.get(REDIS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SharedCatalogEntry;
    if (!Array.isArray(parsed?.models) || parsed.models.length === 0)
      return null;
    return parsed;
  } catch (error) {
    // A cache that cannot be read is a cache miss, never an outage.
    console.warn("[image-studio] shared catalog read failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

async function writeSharedCatalog(entry: SharedCatalogEntry): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;
  try {
    await redis.set(REDIS_KEY, JSON.stringify(entry), "PX", CATALOG_TTL_MS);
  } catch (error) {
    console.warn("[image-studio] shared catalog write failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/** Test seam: forget that this instance ever refreshed. */
export function resetImageCatalogFreshness(): void {
  freshUntil = 0;
  inFlight = null;
}
