import type { Hono } from "hono";

import { agentSyncService } from "@/services/agent-sync.service";
// Imported from the module directly, not through agentSyncService: the
// service file sits at the size ceiling and the x402 readiness sync has no
// other reason to pass through it.
import { syncX402BuySideReadiness } from "@/services/agent-sync.x402-readiness";

import { handleSyncRequest } from "../handler.js";

export const AGENTS_SYNC_LOCK_KEY = "agents-sync";
export const AGENTS_SYNC_METADATA_KEY = "agents-sync-metadata";

export default function mount(app: Hono) {
  app.get("/agents", async (c) => {
    return await handleSyncRequest(c, AGENTS_SYNC_LOCK_KEY, async (context) => {
      // Readiness first: it is cheap, independent of registry data, and must
      // not be starved by a long registry replay eating the time budget. The
      // hard 10s timeout keeps a hung payment node from pinning the lock.
      const readinessChanged =
        await agentSyncService.syncCardanoV2RailReadiness({
          signal: AbortSignal.any([
            context.abortSignal,
            AbortSignal.timeout(10_000),
          ]),
        });
      // x402 buy-side readiness rides the same cron under the same timeout
      // treatment. Its change signal deliberately does NOT reset the registry
      // cursor: the x402 listing reads getX402ReadySources at request time,
      // so nothing readiness-dependent is baked into agent rows (unlike the
      // Cardano readiness, which feeds the projected availability filters).
      await syncX402BuySideReadiness({
        signal: AbortSignal.any([
          context.abortSignal,
          AbortSignal.timeout(10_000),
        ]),
      });
      await agentSyncService.syncRegistryAgents(AGENTS_SYNC_METADATA_KEY, {
        abortSignal: context.abortSignal,
        shouldContinue: context.shouldContinue,
        ...(readinessChanged ? { resetCursor: true } : {}),
      });
    });
  });
}
