import type { Hono } from "hono";

import { freeSubscriptionSyncService } from "@/services/free-subscription-sync.service";

import { handleSyncRequest } from "../handler.js";

export const FREE_SUBSCRIPTIONS_MIGRATION_SYNC_LOCK_KEY =
  "free-subscriptions-migration-sync";

export default function mount(app: Hono) {
  app.get("/free-subscriptions-migration", async (c) => {
    return await handleSyncRequest(
      c,
      FREE_SUBSCRIPTIONS_MIGRATION_SYNC_LOCK_KEY,
      async (context) => {
        await freeSubscriptionSyncService.syncLegacyStripeFreeSubscriptions({
          deadlineMs: context.deadlineMs,
          msRemaining: context.msRemaining,
          shouldContinue: context.shouldContinue,
        });
      },
    );
  });
}
