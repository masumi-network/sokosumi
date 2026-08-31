import type { Hono } from "hono";

import { taskScheduleReconciliationService } from "@/services/task-schedule-reconciliation.service";
import { taskScheduleValidationService } from "@/services/task-schedule-validation.service";
import { taskSchedulesSyncService } from "@/services/task-schedules-sync";

import { handleSyncRequest } from "../handler.js";

export const TASK_SCHEDULES_SYNC_LOCK_KEY = "task-schedules-sync";

export default function mount(app: Hono) {
  app.get("/task-schedules", async (c) => {
    return await handleSyncRequest(
      c,
      TASK_SCHEDULES_SYNC_LOCK_KEY,
      async (context) => {
        const result = await taskSchedulesSyncService.syncDueSchedules({
          abortSignal: context.abortSignal,
          deadlineMs: context.deadlineMs,
          shouldContinue: context.shouldContinue,
        });

        const validation = context.shouldContinue()
          ? await taskScheduleValidationService.validateActiveSchedules({
              shouldContinue: context.shouldContinue,
            })
          : null;
        const reconciliation = context.shouldContinue()
          ? await taskScheduleReconciliationService.reconcileScheduleHistory({
              shouldContinue: context.shouldContinue,
            })
          : null;

        console.info("[sync/task-schedules] Completed sync", {
          ...result,
          validation,
          reconciliation,
        });
      },
    );
  });
}
