import type { Hono } from "hono";

import { reconcileStaleJobs } from "@/services/image-studio-jobs.service";

import { handleSyncRequest } from "../handler.js";

const IMAGE_JOBS_SYNC_LOCK_KEY = "image-jobs-sync";

/** Older than this and nobody is watching the job in a browser. */
const STALE_AFTER_MS = 60_000;
const BATCH = 50;

export default function mount(app: Hono) {
  app.get("/image-jobs", async (c) => {
    return await handleSyncRequest(c, IMAGE_JOBS_SYNC_LOCK_KEY, async () => {
      const result = await reconcileStaleJobs({
        olderThanMs: STALE_AFTER_MS,
        limit: BATCH,
      });
      console.info("[sync/image-jobs] Completed sync", result);
    });
  });
}
