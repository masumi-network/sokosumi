import type { Hono } from "hono";

import { calendarInvalidationOutboxService } from "@/services/calendar-invalidation-outbox.service";
import { failSeoAnalysesOfEndedTasks } from "@/services/project-seo-import.service";
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

        // SEO monitor Runs are Tasks: an analysis whose Task ended without a result is failed.
        const failedSeoAnalyses = context.shouldContinue()
          ? await failSeoAnalysesOfEndedTasks()
          : null;

        context.log.set({
          result: {
            scheduleRelease,
            runAtRelease,
            invalidations,
            failedSeoAnalyses,
          },
        });
      },
      { errorDetail: "safe-fields" },
    );
  });
}
