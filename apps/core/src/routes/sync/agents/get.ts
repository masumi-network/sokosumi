import type { Hono } from "hono";

import { agentSyncService } from "@/services/agent-sync.service";

import { handleSyncRequest } from "../handler.js";

export const AGENTS_SYNC_LOCK_KEY = "agents-sync";
export const AGENTS_SYNC_METADATA_KEY = "agents-sync-metadata";

export default function mount(app: Hono) {
  app.get("/agents", async (c) => {
    return await handleSyncRequest(c, AGENTS_SYNC_LOCK_KEY, async (context) => {
      await agentSyncService.syncRegistryAgents(AGENTS_SYNC_METADATA_KEY, {
        abortSignal: context.abortSignal,
        shouldContinue: context.shouldContinue,
      });
    });
  });

  // One-off backfill lever (CRON_SECRET-protected like the sync itself, same
  // lock): clears the diff cursor and starts a full registry replay — needed
  // after ingestion gains new entry types, because the cursor has already
  // advanced past previously skipped entries. Deliberately a separate path so
  // the recurring cron URL can never carry a permanent reset by mistake.
  app.get("/agents/reset-cursor", async (c) => {
    return await handleSyncRequest(c, AGENTS_SYNC_LOCK_KEY, async (context) => {
      await agentSyncService.syncRegistryAgents(AGENTS_SYNC_METADATA_KEY, {
        abortSignal: context.abortSignal,
        shouldContinue: context.shouldContinue,
        resetCursor: true,
      });
    });
  });
}
