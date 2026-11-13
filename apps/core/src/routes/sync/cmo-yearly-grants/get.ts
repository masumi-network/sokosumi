import type { Hono } from "hono";

import { syncCmoYearlyGrants } from "@/services/cmo-yearly-grant-sync.service";

import { handleSyncRequest } from "../handler.js";

const CMO_YEARLY_GRANTS_SYNC_LOCK_KEY = "cmo-yearly-grants-sync";

/** Grants the running month to each active yearly CMO subscription. */
export default function mount(app: Hono) {
  app.get("/cmo-yearly-grants", async (c) => {
    return await handleSyncRequest(
      c,
      CMO_YEARLY_GRANTS_SYNC_LOCK_KEY,
      async (context) => {
        const result = await syncCmoYearlyGrants(context.shouldContinue);
        console.info("[sync/cmo-yearly-grants] Completed sync", result);
      },
    );
  });
}
