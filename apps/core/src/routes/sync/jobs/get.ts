import type { Hono } from "hono";

import { jobSyncService } from "@/services/job-sync.service";

import { handleSyncRequest } from "../handler.js";

export const JOBS_SYNC_LOCK_KEY = "jobs-sync";

export default function mount(app: Hono) {
  app.get("/jobs", async (c) => {
    return await handleSyncRequest(c, JOBS_SYNC_LOCK_KEY, async (context) => {
      const result = await jobSyncService.syncUnfinishedJobs({
        abortSignal: context.abortSignal,
        deadlineMs: context.deadlineMs,
        shouldContinue: context.shouldContinue,
      });

      console.info("[sync/jobs] Completed sync", result);
    });
  });
}
