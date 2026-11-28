import type { Hono } from "hono";

import { NETWORKS } from "@/lib/network";
import { taskX402PaymentPurgeService } from "@/services/task-x402-payment.purge";

import { handleSyncRequest } from "../handler.js";

const TASK_X402_PAYMENT_HEADERS_PURGE_SYNC_LOCK_KEY =
  "task-x402-payment-headers-purge-sync";

export default function mount(app: Hono) {
  for (const network of NETWORKS) {
    const path =
      network === "mainnet"
        ? "/task-x402-payment-headers-purge"
        : "/preprod/task-x402-payment-headers-purge";
    app.get(path, async (c) => {
      return await handleSyncRequest(
        c,
        TASK_X402_PAYMENT_HEADERS_PURGE_SYNC_LOCK_KEY,
        async (context) => {
          const result =
            await taskX402PaymentPurgeService.purgeExpiredTaskX402PaymentHeaders(
              context.scope.networkDb,
              { abortSignal: context.abortSignal, write: context.lease.write },
            );

          context.log.set({ result: { purged: result.purged } });
        },
        { errorDetail: "safe-fields", network },
      );
    });
  }
}
