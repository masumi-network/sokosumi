import type { Hono } from "hono";

import { expiredVerificationsPurgeService } from "@/services/expired-verifications.purge";

import { handleSyncRequest } from "../handler.js";

const EXPIRED_VERIFICATIONS_PURGE_SYNC_LOCK_KEY =
  "expired-verifications-purge-sync";

export default function mount(app: Hono) {
  app.get("/expired-verifications-purge", async (c) => {
    return await handleSyncRequest(
      c,
      EXPIRED_VERIFICATIONS_PURGE_SYNC_LOCK_KEY,
      async (context) => {
        const result =
          await expiredVerificationsPurgeService.purgeExpiredVerifications({
            abortSignal: context.abortSignal,
          });

        context.log.set({ result: { purged: result.purged } });
      },
      { errorDetail: "cause" },
    );
  });
}
