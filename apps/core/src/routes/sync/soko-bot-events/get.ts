import type { Hono } from "hono";

import { sokoBotEventsSyncService } from "@/services/soko-bot-events-sync.service";

import { handleSyncRequest } from "../handler.js";

export const SOKO_BOT_EVENTS_SYNC_LOCK_KEY = "soko-bot-events-sync";

export default function mount(app: Hono) {
  app.get("/soko-bot-events", async (c) => {
    return await handleSyncRequest(
      c,
      SOKO_BOT_EVENTS_SYNC_LOCK_KEY,
      async (context) => {
        const result = await sokoBotEventsSyncService.syncDelegatedWork({
          abortSignal: context.abortSignal,
          shouldContinue: context.shouldContinue,
        });
        console.info("[sync/soko-bot-events] Completed sync", result);
      },
    );
  });
}
