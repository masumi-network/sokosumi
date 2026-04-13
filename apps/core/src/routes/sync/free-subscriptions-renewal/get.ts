import type { Hono } from "hono";

import { freeSubscriptionSyncService } from "@/services/free-subscription-sync.service";

import { handleSyncRequest } from "../handler.js";

export const FREE_SUBSCRIPTIONS_RENEWAL_SYNC_LOCK_KEY =
  "free-subscriptions-renewal-sync";

export default function mount(app: Hono) {
  app.get("/free-subscriptions-renewal", async (c) => {
    return await handleSyncRequest(
      c,
      FREE_SUBSCRIPTIONS_RENEWAL_SYNC_LOCK_KEY,
      async (context) => {
        console.info(
          "[sync/free-subscriptions-renewal] Starting local free subscription renewal",
        );
        const startedAt = Date.now();
        const result =
          await freeSubscriptionSyncService.renewLocalFreeSubscriptions({
            deadlineMs: context.deadlineMs,
            msRemaining: context.msRemaining,
            shouldContinue: context.shouldContinue,
          });

        console.info("[sync/free-subscriptions-renewal] Completed sync", {
          durationMs: Date.now() - startedAt,
          renewalErrors: result.renewalErrors,
          renewed: result.renewed,
          stoppedEarly: result.stoppedEarly,
        });
      },
    );
  });
}
