import type { Hono } from "hono";

import { syncCmoCompetitorChecks } from "@/services/cmo-competitor-check.service";

import { handleSyncRequest } from "../handler.js";

const CMO_COMPETITORS_SYNC_LOCK_KEY = "cmo-competitors-sync";
/** A check reads a few pages per competitor; one more must fit before the cut. */
const CHECK_HEADROOM_MS = 120_000;

/** Runs the weekly competitor check of each paid Cuso whose check is due. */
export default function mount(app: Hono) {
  app.get("/cmo-competitors", async (c) => {
    return await handleSyncRequest(
      c,
      CMO_COMPETITORS_SYNC_LOCK_KEY,
      async (context) => {
        const result = await syncCmoCompetitorChecks(
          () =>
            context.shouldContinue() &&
            context.msRemaining() > CHECK_HEADROOM_MS,
        );
        context.log.set({ result });
      },
      { errorDetail: "safe-fields" },
    );
  });
}
