import "server-only";

import { cacheLife } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";

import { getAllCoreAgents, getCoreCategories } from "@/lib/agents/core-loaders";
import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";
import { coworkerService } from "@/lib/services/coworker.service";

function logAgentsCatalogFetchFailure(scope: string, error: unknown): void {
  console.warn(`[agents] ${scope} fetch failed`, {
    message: error instanceof Error ? error.message : String(error),
  });
}

function readCoworkers() {
  return coworkerService.listCoworkers("tasks");
}

async function readPrivateCachedCoworkers() {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  return readCoworkers();
}

/**
 * The coworkers the gallery offers, cached for the browser only, so a link
 * prefetch carries them. A failed read is never kept: the click reads Core
 * again, and a second failure shows an empty gallery, as before.
 */
export function loadAgentsCoworkers() {
  return readPrivateCachedCoworkers().catch(async (error: unknown) => {
    unstable_rethrow(error);
    await connection();
    return readCoworkers().catch((cause: unknown) => {
      unstable_rethrow(cause);
      return [];
    });
  });
}

function readCatalog() {
  return Promise.all([getAllCoreAgents(), getCoreCategories()]);
}

// The catalog reads are shared across users. This browser-only layer runs
// only for a request or a prefetch, never at build time, so a build with Core
// unreachable cannot bake an empty catalog into the page.
async function readPrivateCachedCatalog() {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  return readCatalog();
}

/**
 * The agent catalog and its categories, cached for the browser only, so a
 * link prefetch carries them. A failed read is never kept: the click reads
 * Core again, and each list that fails again renders empty, as before.
 */
export function loadAgentsCatalog() {
  return readPrivateCachedCatalog().catch(async (error: unknown) => {
    unstable_rethrow(error);
    await connection();
    return Promise.all([
      getAllCoreAgents().catch((cause: unknown) => {
        unstable_rethrow(cause);
        logAgentsCatalogFetchFailure("agent catalog", cause);
        return [];
      }),
      getCoreCategories().catch((cause: unknown) => {
        unstable_rethrow(cause);
        logAgentsCatalogFetchFailure("categories", cause);
        return [];
      }),
    ]);
  });
}
