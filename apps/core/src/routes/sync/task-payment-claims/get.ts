import type { Hono } from "hono";

import { syncPendingTaskPaymentClaims } from "@/services/task-payment-claim.service";

import { handleSyncRequest } from "../handler.js";

export const TASK_PAYMENT_CLAIMS_SYNC_LOCK_KEY = "task-payment-claims-sync";

export default function mount(app: Hono) {
  app.get("/task-payment-claims", async (c) => {
    return await handleSyncRequest(
      c,
      TASK_PAYMENT_CLAIMS_SYNC_LOCK_KEY,
      async (context) => {
        const result = await syncPendingTaskPaymentClaims({
          abortSignal: context.abortSignal,
          shouldContinue: context.shouldContinue,
        });
        console.info("[sync/task-payment-claims] Completed sync", result);
      },
    );
  });
}
