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

  // One-off recovery lever (CRON_SECRET-protected like the sync itself, same
  // lock): clears the active rollout cursor and starts a full registry replay.
  // Normal V2 enablement replays automatically via its dedicated cursor.
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
