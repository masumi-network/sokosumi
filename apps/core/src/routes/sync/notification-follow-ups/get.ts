import type { Hono } from "hono";

import { notificationFollowUpSyncService } from "@/services/notification-follow-up-sync.service";

import { handleSyncRequest } from "../handler.js";

export const NOTIFICATION_FOLLOW_UPS_SYNC_LOCK_KEY =
  "notification-follow-ups-sync";

export default function mount(app: Hono) {
  app.get("/notification-follow-ups", async (c) => {
    return await handleSyncRequest(
      c,
      NOTIFICATION_FOLLOW_UPS_SYNC_LOCK_KEY,
      async (context) => {
        console.info(
          "[sync/notification-follow-ups] Starting follow-up notifications",
        );
        const startedAt = Date.now();
        const result = await notificationFollowUpSyncService.sendFollowUps({
          abortSignal: context.abortSignal,
          shouldContinue: context.shouldContinue,
        });

        console.info("[sync/notification-follow-ups] Completed sync", {
          durationMs: Date.now() - startedAt,
          examined: result.examined,
          sent: result.sent,
          // False means the deadline ended the run with rows still waiting,
          // and those rows leave the eligibility window before the next run.
          // True does not mean nothing was lost: a write that throws is
          // counted in `examined`, never in `sent`, and goes to Sentry.
          completed: result.completed,
        });
      },
    );
  });
}
