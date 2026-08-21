import type { Hono } from "hono";

import { taskX402PaymentPurgeService } from "@/services/task-x402-payment.purge";

import { handleSyncRequest } from "../handler.js";

export const TASK_X402_PAYMENT_HEADERS_PURGE_SYNC_LOCK_KEY =
  "task-x402-payment-headers-purge-sync";

export default function mount(app: Hono) {
  app.get("/task-x402-payment-headers-purge", async (c) => {
    return await handleSyncRequest(
      c,
      TASK_X402_PAYMENT_HEADERS_PURGE_SYNC_LOCK_KEY,
      async (context) => {
        console.info(
          "[sync/task-x402-payment-headers-purge] Starting expired x402 header purge",
        );
        const startedAt = Date.now();
        const result =
          await taskX402PaymentPurgeService.purgeExpiredTaskX402PaymentHeaders({
            abortSignal: context.abortSignal,
          });

        console.info("[sync/task-x402-payment-headers-purge] Completed sync", {
          durationMs: Date.now() - startedAt,
          purged: result.purged,
        });
      },
    );
  });
}
