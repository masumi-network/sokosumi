import type { Hono } from "hono";

import { agentSyncService } from "@/services/agent-sync.service";

import { handleSyncRequest } from "../handler.js";

export const AGENTS_SYNC_LOCK_KEY = "agents-sync";
export const AGENTS_SYNC_METADATA_KEY = "agents-sync-metadata";

export default function mount(app: Hono) {
  app.get("/agents", async (c) => {
    // One-off backfill lever (CRON_SECRET-protected like the sync itself):
    // ?resetCursor=true clears the diff cursor so the next run replays every
    // registry entry — needed after ingestion gains new entry types, because
    // the cursor has already advanced past previously skipped entries.
    const resetCursor = c.req.query("resetCursor") === "true";
    return await handleSyncRequest(c, AGENTS_SYNC_LOCK_KEY, async (context) => {
      await agentSyncService.syncRegistryAgents(AGENTS_SYNC_METADATA_KEY, {
        abortSignal: context.abortSignal,
        shouldContinue: context.shouldContinue,
        resetCursor,
      });
    });
  });
}
