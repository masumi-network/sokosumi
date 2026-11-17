import type { Hono } from "hono";

import { taskX402PaymentPurgeService } from "@/services/task-x402-payment.purge";

import { handleSyncRequest } from "../handler.js";

const TASK_X402_PAYMENT_HEADERS_PURGE_SYNC_LOCK_KEY =
  "task-x402-payment-headers-purge-sync";

export default function mount(app: Hono) {
  app.get("/task-x402-payment-headers-purge", async (c) => {
    return await handleSyncRequest(
      c,
      TASK_X402_PAYMENT_HEADERS_PURGE_SYNC_LOCK_KEY,
      async (context) => {
        const result =
          await taskX402PaymentPurgeService.purgeExpiredTaskX402PaymentHeaders({
            abortSignal: context.abortSignal,
          });

        context.log.set({ result: { purged: result.purged } });
      },
      { errorDetail: "safe-fields" },
    );
  });
}
