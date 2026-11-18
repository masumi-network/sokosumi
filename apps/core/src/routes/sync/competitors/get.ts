import type { Hono } from "hono";

import { syncCompetitorChecks } from "@/services/competitor-check-sync.service";

import { handleSyncRequest } from "../handler.js";

const COMPETITORS_SYNC_LOCK_KEY = "competitors-sync";
/** A check reads a few pages per competitor; one more must fit before the cut. */
const CHECK_HEADROOM_MS = 120_000;

/**
 * Runs the weekly competitor check of each Project whose check is due: paid
 * Cusos, and Projects whose members turned it on.
 */
export default function mount(app: Hono) {
  app.get("/competitors", async (c) => {
    return await handleSyncRequest(
      c,
      COMPETITORS_SYNC_LOCK_KEY,
      async (context) => {
        const result = await syncCompetitorChecks(
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
