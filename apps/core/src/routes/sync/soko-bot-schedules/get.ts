import { waitUntil } from "@vercel/functions";
import type { Hono } from "hono";
import { emitCoreError, runAsBackgroundWork } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { reportSokoBotReconciliationLeaseLoss } from "@/lib/soko-bot/reconciliation-lease";
import { sokoBotControlPlane } from "@/services/soko-bot-control-plane.service";
import { purgeSokoBotSchedules } from "@/services/soko-bot-schedule.service";
import { sokoBotSchedulesSyncService } from "@/services/soko-bot-schedules-sync.service";

import type { SyncRunContext } from "../handler.js";
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
            // Background work: it outlives the run, so its events are its own.
            waitUntil(
              runAsBackgroundWork(() =>
                sokoBotControlPlane
                  .reconcileTurn(turnId, context.abortSignal, leaseToken)
                  .catch((error) => {
                    if (reportSokoBotReconciliationLeaseLoss(turnId, error))
                      return;
                    emitCoreError(
                      {
                        operation: "soko_bot_schedule_reconciliation",
                        turn: { id: turnId },
                      },
                      {
                        message:
                          "Could not reconcile a scheduled Soko Bot turn",
                        why: "Reconciling the turn right after its schedule started it failed",
                        fix: "Nothing to do now: the next soko-bot-turns sync tries the turn again, and its deadline expires it if it never recovers.",
                      },
                      // Only safe fields: turn work can echo its prompt.
                      { failure: messageSafeErrorFields(error) },
                    );
                  }),
              ),
            );
          },
        });
        context.log.set({ result });
        await purgeSchedules(context);
      },
      { errorDetail: "safe-fields" },
    );
  });
}

/** What the purge removed goes on the run's event, next to its counts. */
async function purgeSchedules({ log }: SyncRunContext) {
  try {
    const purged = await purgeSokoBotSchedules();
    log.set({ result: { purged } });
  } catch (error) {
    emitCoreError(
      { operation: "soko_bot_schedule_purge" },
      {
        message: "Could not purge spent Soko Bot schedules",
        why: "The database delete of spent schedules failed",
        fix: "Nothing to do now: the next soko-bot-schedules sync purges them; spent schedules only take space until then.",
      },
      // Only safe fields: a schedule carries its prompt.
      { failure: messageSafeErrorFields(error) },
    );
  }
}
