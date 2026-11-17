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
        // Revokes after the grants, so revokes failing one by one (each up to
        // the Polar SDK's 5 s timeout) cannot take their time; and in
        // `finally`, so failing grants cannot stop a revoke.
        try {
          const result = await syncPolarYearlyGrants(context.shouldContinue);
          context.log.set({ result: { grants: result } });
        } finally {
          const revokes = await retryOwedPolarRevokes(context.shouldContinue);
          context.log.set({ result: { revokes } });
        }
      },
      { errorDetail: "safe-fields" },
    );
  });
}
