import type { Hono } from "hono";

import { jobScheduleSyncService } from "@/services/job-schedule-sync.service";

import { handleSyncRequest } from "../handler.js";

export const JOB_SCHEDULES_SYNC_LOCK_KEY = "job-schedules-sync";

export default function mount(app: Hono) {
  app.get("/job-schedules", async (c) => {
    return await handleSyncRequest(
      c,
      JOB_SCHEDULES_SYNC_LOCK_KEY,
      async (context) => {
        const startedAt = Date.now();
        const result = await jobScheduleSyncService.executeDueSchedules({
          abortSignal: context.abortSignal,
          deadlineMs: context.deadlineMs,
          shouldContinue: context.shouldContinue,
        });
        console.info("[sync/job-schedules] Completed sync", {
          seconds: (Date.now() - startedAt) / 1000,
          dueFound: result.dueFound,
          processed: result.processed,
          paused: result.paused,
          skippedLocked: result.skippedLocked,
          durationMs: result.durationMs,
        });
      },
    );
  });
}
