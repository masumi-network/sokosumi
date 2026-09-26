import type { Hono } from "hono";

import { calendarInvalidationOutboxService } from "@/services/calendar-invalidation-outbox.service";
import { taskScheduleReleaseService } from "@/services/task-schedule-runs.service";

import { handleSyncRequest } from "../handler.js";

const TASK_SCHEDULES_SYNC_LOCK_KEY = "task-schedules-sync";

export default function mount(app: Hono) {
  app.get("/task-schedules", async (c) => {
    return await handleSyncRequest(
      c,
      TASK_SCHEDULES_SYNC_LOCK_KEY,
      async (context) => {
        const executionOptions = {
          abortSignal: context.abortSignal,
          deadlineMs: context.deadlineMs,
          shouldContinue: context.shouldContinue,
        };
        const scheduleRelease =
          await taskScheduleReleaseService.releaseDueSchedules(
            executionOptions,
          );

        const runAtRelease = context.shouldContinue()
          ? await taskScheduleReleaseService.releaseDueRunAts(executionOptions)
          : null;

        const invalidations = context.shouldContinue()
          ? await calendarInvalidationOutboxService.syncInvalidations({
              newestFirst: true,
              shouldContinue: context.shouldContinue,
            })
          : null;

        console.info("[sync/task-schedules] Completed sync", {
          scheduleRelease,
          runAtRelease,
          invalidations,
        });
      },
    );
  });
}
