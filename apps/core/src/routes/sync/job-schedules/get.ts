import type { Hono } from "hono";

import { jobScheduleSyncService } from "@/services/job-schedule-sync.service";

import { handleSyncRequest } from "../handler.js";

export const JOB_SCHEDULES_SYNC_LOCK_KEY = "job-schedules-sync";

export default function mount(app: Hono) {
  app.get("/job-schedules", async (c) => {
    return await handleSyncRequest(c, JOB_SCHEDULES_SYNC_LOCK_KEY, async () => {
      const result = await jobScheduleSyncService.executeDueSchedules();
      console.info("[sync/job-schedules] Completed", result);
    });
  });
}
