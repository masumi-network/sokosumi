import type { Hono } from "hono";

import { retryOwedPolarRevokes } from "@/services/polar-subscription-end.service";
import { syncPolarYearlyGrants } from "@/services/polar-yearly-grant-sync.service";

import { handleSyncRequest } from "../handler.js";

const POLAR_YEARLY_GRANTS_SYNC_LOCK_KEY = "polar-yearly-grants-sync";

/**
 * Grants the running month to each active yearly CMO subscription, then
 * revokes at Polar what an ending could not.
 */
export default function mount(app: Hono) {
  app.get("/polar-yearly-grants", async (c) => {
    return await handleSyncRequest(
      c,
      POLAR_YEARLY_GRANTS_SYNC_LOCK_KEY,
      async (context) => {
        const result = await syncPolarYearlyGrants(context.shouldContinue);
        console.info("[sync/polar-yearly-grants] Completed sync", result);
        // After the grants: Polar's SDK sets no timeout, so a revoke that
        // hangs there would take their time.
        const revokes = await retryOwedPolarRevokes(context.shouldContinue);
        console.info(
          "[sync/polar-yearly-grants] Retried owed revokes",
          revokes,
        );
      },
    );
  });
}
