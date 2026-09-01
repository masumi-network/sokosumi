import type { Hono } from "hono";

import { jobSyncService } from "@/services/job-sync.service";

import { handleSyncRequest } from "../handler.js";

export const JOBS_SYNC_LOCK_KEY = "jobs-sync";

export default function mount(app: Hono) {
  app.get("/jobs", async (c) => {
    // Escape hatch for the purchase diff, mirroring GET /sync/agents?replay=true:
    // the cursor is dropped and the whole feed replayed, so a purchase the diff
    // never delivered still reaches its job.
    const replayRequested = c.req.query("replay") === "true";
    return await handleSyncRequest(c, JOBS_SYNC_LOCK_KEY, async (context) => {
      const result = await jobSyncService.syncUnfinishedJobs({
        abortSignal: context.abortSignal,
        deadlineMs: context.deadlineMs,
        shouldContinue: context.shouldContinue,
        ...(replayRequested ? { resetPurchaseCursor: true } : {}),
      });

      console.info("[sync/jobs] Completed sync", result);
    });
  });
}
