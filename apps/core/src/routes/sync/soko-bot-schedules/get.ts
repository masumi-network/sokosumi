import { waitUntil } from "@vercel/functions";
import type { Hono } from "hono";

import { createCoreLogger } from "@/lib/evlog";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { purgeSokoBotSchedules } from "@/services/soko-bot-schedule.service";
import { sokoBotSchedulesSyncService } from "@/services/soko-bot-schedules-sync.service";

import { handleSyncRequest } from "../handler.js";

const SOKO_BOT_SCHEDULES_SYNC_LOCK_KEY = "soko-bot-schedules-sync";

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
        await purgeSchedules();
      },
    );
  });
}

/** One wide event per tick that removed anything; quiet ticks log nothing. */
async function purgeSchedules() {
  try {
    const purged = await purgeSokoBotSchedules();
    if (Object.values(purged).some((count) => count > 0)) {
      const log = createCoreLogger({ operation: "soko_bot_schedule_purge" });
      log.set({ purged });
      log.emit();
    }
  } catch (error) {
    console.error("Soko Bot schedule purge failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}
