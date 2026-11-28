import type { Hono } from "hono";

import { freeSubscriptionSyncService } from "@/services/free-subscription-sync.service";

import { handleSyncRequest } from "../handler.js";

const FREE_SUBSCRIPTIONS_RENEWAL_SYNC_LOCK_KEY =
  "free-subscriptions-renewal-sync";

export default function mount(app: Hono) {
  app.get("/free-subscriptions-renewal", async (c) => {
    return await handleSyncRequest(
      c,
      FREE_SUBSCRIPTIONS_RENEWAL_SYNC_LOCK_KEY,
      async (context) => {
        const result =
          await freeSubscriptionSyncService.renewLocalFreeSubscriptions({
            deadlineMs: context.deadlineMs,
            msRemaining: context.msRemaining,
            shouldContinue: context.shouldContinue,
            scope: context.scope,
          });

        context.log.set({
          result: {
            preCreated: result.preCreated,
            renewalErrors: result.renewalErrors,
            renewed: result.renewed,
            stoppedEarly: result.stoppedEarly,
          },
        });
      },
      // The free plan's credits are Mainnet's.
      { errorDetail: "cause", network: "mainnet" },
    );
  });
}
