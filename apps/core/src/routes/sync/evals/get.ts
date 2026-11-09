import type { Hono } from "hono";

import { EVAL_TICK_LOCK_KEY, syncEvals } from "@/services/evals/eval-cron";

import { handleSyncRequest } from "../handler.js";

/** Queues the daily eval run on mainnet and moves the running run on. */
export default function mount(app: Hono) {
  app.get("/evals", async (c) => {
    return await handleSyncRequest(c, EVAL_TICK_LOCK_KEY, async (context) => {
      const result = await syncEvals(context.shouldContinue);
      if (result.runId) console.info("[sync/evals] Completed sync", result);
    });
  });
}
