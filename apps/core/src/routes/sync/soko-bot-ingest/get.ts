import type { Hono } from "hono";

import { sokoBotIngestSyncService } from "@/services/soko-bot-ingest.service";

import { handleSyncRequest } from "../handler.js";

export const SOKO_BOT_INGEST_SYNC_LOCK_KEY = "soko-bot-ingest-sync";

export default function mount(app: Hono) {
  app.get("/soko-bot-ingest", async (c) => {
    return await handleSyncRequest(
      c,
      SOKO_BOT_INGEST_SYNC_LOCK_KEY,
      async (context) => {
        const result = await sokoBotIngestSyncService.syncIngest({
          abortSignal: context.abortSignal,
          shouldContinue: context.shouldContinue,
        });
        console.info("[sync/soko-bot-ingest] Completed sync", result);
      },
    );
  });
}
