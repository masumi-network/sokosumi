import type { Hono } from "hono";

import { sokoBotEventsSyncService } from "@/services/soko-bot-events-sync.service";
import { adoptCoworkerSubtasks } from "@/services/soko-bot-subtask-adoption.service";
import { sokoBotTaskboardSyncService } from "@/services/soko-bot-taskboard-sync.service";

import { syncSokoBotWatches } from "@/services/soko-bot-watches.service";
import { handleSyncRequest } from "../handler.js";

const SOKO_BOT_EVENTS_SYNC_LOCK_KEY = "soko-bot-events-sync";

export default function mount(app: Hono) {
  app.get("/soko-bot-events", async (c) => {
    return await handleSyncRequest(
      c,
      SOKO_BOT_EVENTS_SYNC_LOCK_KEY,
      async (context) => {
        const adopted = await adoptCoworkerSubtasks();
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
        if (!context.shouldContinue()) return;
        const taskboard = await sokoBotTaskboardSyncService.syncTaskboard({
          abortSignal: context.abortSignal,
          shouldContinue: context.shouldContinue,
        });
        context.log.set({ result: { taskboard } });
      },
      { errorDetail: "safe-fields" },
    );
  });
}
