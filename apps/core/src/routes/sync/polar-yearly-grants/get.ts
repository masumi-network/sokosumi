import type { Hono } from "hono";

import { syncPolarYearlyGrants } from "@/services/polar-yearly-grant-sync.service";

import { handleSyncRequest } from "../handler.js";

const POLAR_YEARLY_GRANTS_SYNC_LOCK_KEY = "polar-yearly-grants-sync";

/** Grants the running month to each active yearly CMO subscription. */
export default function mount(app: Hono) {
  app.get("/polar-yearly-grants", async (c) => {
    return await handleSyncRequest(
      c,
      POLAR_YEARLY_GRANTS_SYNC_LOCK_KEY,
      async (context) => {
        const result = await syncPolarYearlyGrants(context.shouldContinue);
        console.info("[sync/polar-yearly-grants] Completed sync", result);
      },
    );
  });
}
