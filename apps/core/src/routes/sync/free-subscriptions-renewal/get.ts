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
        await freeSubscriptionSyncService.renewLocalFreeSubscriptions({
          deadlineMs: context.deadlineMs,
          msRemaining: context.msRemaining,
          shouldContinue: context.shouldContinue,
        });
      },
    );
  });
}
