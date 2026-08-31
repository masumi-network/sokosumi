import type { Hono } from "hono";

import { sokoBotTurnsSyncService } from "@/services/soko-bot-turns-sync.service";

import { handleSyncRequest } from "../handler.js";

export const SOKO_BOT_TURNS_SYNC_LOCK_KEY = "soko-bot-turns-sync";

export default function mount(app: Hono) {
  app.get("/soko-bot-turns", async (c) => {
    return await handleSyncRequest(
      c,
      SOKO_BOT_TURNS_SYNC_LOCK_KEY,
      async (context) => {
        const result = await sokoBotTurnsSyncService.syncActiveTurns({
          abortSignal: context.abortSignal,
          shouldContinue: context.shouldContinue,
        });
        console.info("[sync/soko-bot-turns] Completed sync", result);
      },
    );
  });
}
