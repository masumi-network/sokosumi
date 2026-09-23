import type { Hono } from "hono";

import { notificationFollowUpSyncService } from "@/services/notification-follow-up-sync.service";

import { handleSyncRequest } from "../handler.js";

const NOTIFICATION_FOLLOW_UPS_SYNC_LOCK_KEY = "notification-follow-ups-sync";

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
          // Reminders handed to Resend, not reminders delivered. The field
          // itself says what the difference covers.
          emailed: result.emailed,
          // What false does and does not mean is on the field itself, in
          // `SendFollowUpsResult`. It is logged because it says the deadline
          // is deciding how much this run gets done.
          reachedEnd: result.reachedEnd,
        });
      },
    );
  });
}
