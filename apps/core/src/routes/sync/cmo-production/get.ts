import type { Hono } from "hono";

import { syncCmoProduction } from "@/services/cmo-production.service";

import { handleSyncRequest } from "../handler.js";

const CMO_PRODUCTION_SYNC_LOCK_KEY = "cmo-production-sync";

/** Starts or resumes each paid CMO month whose pieces are not all made. */
export default function mount(app: Hono) {
  app.get("/cmo-production", async (c) => {
    return await handleSyncRequest(
      c,
      CMO_PRODUCTION_SYNC_LOCK_KEY,
      async (context) => {
        const result = await syncCmoProduction(context.shouldContinue);
        console.info("[sync/cmo-production] Completed sync", result);
      },
    );
  });
}
