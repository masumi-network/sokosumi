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
          // False means the run stopped early, either on the deadline with
          // rows still waiting or on an abort before it read anything. One is
          // survivable, because the window is twice the interval. False on
          // consecutive runs is the warning worth acting on.
          completed: result.completed,
        });
      },
    );
  });
}
