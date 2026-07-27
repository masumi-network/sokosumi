import type { Hono } from "hono";

import { agentSyncService } from "@/services/agent-sync.service";

import { handleSyncRequest } from "../handler.js";

export const AGENTS_SYNC_LOCK_KEY = "agents-sync";
export const AGENTS_SYNC_METADATA_KEY = "agents-sync-metadata";

export default function mount(app: Hono) {
  app.get("/agents", async (c) => {
    return await handleSyncRequest(c, AGENTS_SYNC_LOCK_KEY, async (context) => {
      // Readiness first: it is cheap, independent of registry data, and must
      // not be starved by a long registry replay eating the time budget. The
      // hard 10s timeout keeps a hung payment node from pinning the lock.
      await agentSyncService.syncCardanoV2RailReadiness({
        signal: AbortSignal.any([
          context.abortSignal,
          AbortSignal.timeout(10_000),
        ]),
      });
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
