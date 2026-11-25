import type { Hono } from "hono";

import { syncCmoProduction } from "@/services/cmo-production.service";
import { tearDownExpiredTestCopies } from "@/services/cmo-test-copy.service";

import { handleSyncRequest } from "../handler.js";

const CMO_PRODUCTION_SYNC_LOCK_KEY = "cmo-production-sync";

/**
 * Tears down expired CMO test copies, then starts or resumes each paid CMO
 * month whose pieces are not all made.
 */
export default function mount(app: Hono) {
  app.get("/cmo-production", async (c) => {
    return await handleSyncRequest(
      c,
      CMO_PRODUCTION_SYNC_LOCK_KEY,
      async (context) => {
        // First, so no test copy outlives the six hours it may live.
        const testCopies = await tearDownExpiredTestCopies(
          context.shouldContinue,
        );
        const result = await syncCmoProduction(context.shouldContinue);
        context.log.set({ result, testCopies });
        context.reportWork(result.checked);
      },
      // Paying Cusos always have an approved plan: an hour of 10-minute runs
      // that check none means the list or the sync broke.
      { errorDetail: "safe-fields", idleRunsAlert: 6 },
    );
  });
}
