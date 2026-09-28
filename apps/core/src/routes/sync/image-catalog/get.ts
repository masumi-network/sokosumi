import type { Hono } from "hono";

import { refreshImageCatalog } from "@/lib/image-studio/fal-catalog-refresh";

import { handleSyncRequest } from "../handler.js";

/**
 * Re-read fal's catalog and share it with every instance.
 *
 * The only place in a deployment that crawls fal. A crawl is roughly 210 paced
 * provider reads and takes minutes, which is why it is a scheduled job and not
 * something a page load starts: the previous arrangement triggered it from the
 * catalog route, and every attempt was aborted when its request ended, so Redis
 * was never populated and each cold start logged a timeout that looked like an
 * incident.
 *
 * Nothing depends on this succeeding. The committed snapshot is a complete
 * catalog, so a deployment that never runs this — **including every preview,
 * because Vercel runs crons on production only** — serves the snapshot for its
 * whole life, and the studio works. What this buys is a catalog that follows fal
 * between snapshot regenerations.
 *
 * Hourly rather than every five minutes: the TTL on the shared entry is six
 * hours, fal's catalog moves on the scale of days, and each run costs a couple of
 * hundred requests against a rate limit that already refuses seven a second.
 */
const IMAGE_CATALOG_SYNC_LOCK_KEY = "image-catalog-sync";

export default function mount(app: Hono) {
  app.get("/image-catalog", async (c) => {
    return await handleSyncRequest(
      c,
      IMAGE_CATALOG_SYNC_LOCK_KEY,
      async (context) => {
        // The crawl stops itself inside the invocation's budget rather than being
        // killed mid-flight, and a crawl cut short is discarded rather than
        // adopted — a partial catalog would take working models out of the
        // composer.
        const refreshed = await refreshImageCatalog({
          shouldContinue: context.shouldContinue,
        });
        console.info("[sync/image-catalog] Completed sync", { refreshed });
      },
    );
  });
}
