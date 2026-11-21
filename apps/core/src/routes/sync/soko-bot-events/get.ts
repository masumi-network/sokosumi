import type { Hono } from "hono";

import { sokoBotEventsSyncService } from "@/services/soko-bot-events-sync.service";
import { adoptCoworkerSpawnedTasks } from "@/services/soko-bot-spawned-task-adoption.service";
import { sokoBotTaskboardSyncService } from "@/services/soko-bot-taskboard-sync.service";

import { syncSokoBotWatches } from "@/services/soko-bot-watches.service";
import { syncTaskInterest } from "@/services/task-interest-delivery.service";
import { syncTeamStandups } from "@/services/team-standup.service";
import { handleSyncRequest } from "../handler.js";

const SOKO_BOT_EVENTS_SYNC_LOCK_KEY = "soko-bot-events-sync";

export default function mount(app: Hono) {
  app.get("/soko-bot-events", async (c) => {
    return await handleSyncRequest(
      c,
      SOKO_BOT_EVENTS_SYNC_LOCK_KEY,
      async (context) => {
        // The tick's own minute, not the minute the Task interest step
        // reaches: its overdue sweep runs on quarter-hour ticks.
        const tickStartedAt = new Date();
        const adopted = await adoptCoworkerSpawnedTasks();
        context.log.set({ result: { adopted } });
        const watches = await syncSokoBotWatches({
          shouldContinue: context.shouldContinue,
        });
        context.log.set({ result: { watches } });
        if (!context.shouldContinue()) return;
        const result = await sokoBotEventsSyncService.syncDelegatedWork({
          abortSignal: context.abortSignal,
          shouldContinue: context.shouldContinue,
        });
        context.log.set({ result: { delegatedWork: result } });
        // After delegated work: a burst of completion summaries must not
        // hold back the wakes that bots asked for.
        if (!context.shouldContinue()) return;
        const interest = await syncTaskInterest({
          abortSignal: context.abortSignal,
          shouldContinue: context.shouldContinue,
          now: tickStartedAt,
        });
        context.log.set({ result: { taskInterest: interest } });
        if (!context.shouldContinue()) return;
        const taskboard = await sokoBotTaskboardSyncService.syncTaskboard({
          abortSignal: context.abortSignal,
          shouldContinue: context.shouldContinue,
        });
        context.log.set({ result: { taskboard } });
        if (!context.shouldContinue()) return;
        const standups = await syncTeamStandups({
          shouldContinue: context.shouldContinue,
        });
        context.log.set({ result: { standups } });
      },
      { errorDetail: "safe-fields" },
    );
  });
}
