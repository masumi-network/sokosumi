import { waitUntil } from "@vercel/functions";
import type { Hono } from "hono";

import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { sokoBotSchedulesSyncService } from "@/services/soko-bot-schedules-sync.service";

import { handleSyncRequest } from "../handler.js";

export const SOKO_BOT_SCHEDULES_SYNC_LOCK_KEY = "soko-bot-schedules-sync";

export default function mount(app: Hono) {
  app.get("/soko-bot-schedules", async (c) => {
    return await handleSyncRequest(
      c,
      SOKO_BOT_SCHEDULES_SYNC_LOCK_KEY,
      async (context) => {
        const result = await sokoBotSchedulesSyncService.syncDueSchedules({
          shouldContinue: context.shouldContinue,
          enqueueReconciliation: ({ turnId, leaseToken }) => {
            waitUntil(
              sokoBotControlPlane
                .reconcileTurn(turnId, context.abortSignal, leaseToken)
                .catch((error) => {
                  console.error(
                    "Scheduled Soko Bot turn reconciliation failed",
                    {
                      turnId,
                      error: error instanceof Error ? error.message : "unknown",
                    },
                  );
                }),
            );
          },
        });
        console.info("[sync/soko-bot-schedules] Completed sync", result);
      },
    );
  });
}
