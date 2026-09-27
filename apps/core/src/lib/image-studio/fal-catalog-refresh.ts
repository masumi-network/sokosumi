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
 * - **An in-process TTL** means one instance asks fal at most once every six
 *   hours, whatever the request rate.
 * - **A shared Redis entry** means the instances do not each ask. Twenty
 *   instances rolling at once is twenty full catalog crawls of fal's API, which
 *   is how a deploy earns a rate limit.
 *
 * The one rule: a refresh failure logs and keeps serving the last good catalog.
 * There is no path here that empties the studio, and no path that makes a user
 * request wait on fal — the fal crawl is hundreds of reads and is always
 * detached from whoever triggered it.
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
 * Bring the resolved catalog up to date, cheaply, and return immediately.
 *
 * Awaiting this is safe from a request handler: the only thing it ever waits for
 * is a Redis read. The provider crawl, when one is needed, is started and left
 * to finish on its own, because the snapshot already answers the question the
 * caller is asking and waiting several seconds to answer it better is not a
 * trade any page load should make.
 */
export async function ensureImageCatalogFresh(): Promise<void> {
  if (Date.now() < freshUntil) return;

  const shared = await readSharedCatalog();
  if (shared && setResolvedImageCatalog(shared.models, shared.fetchedAt)) {
    markFresh();
    return;
  }

  void refreshImageCatalog();
}

/**
 * Crawl fal, adopt the result, and share it.
 *
 * Exported for the refresh script and for tests. Resolves either way — the
 * boolean says whether the catalog moved, and a false is a logged non-event, not
 * an error the caller has to handle.
 */
export async function refreshImageCatalog(): Promise<boolean> {
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
