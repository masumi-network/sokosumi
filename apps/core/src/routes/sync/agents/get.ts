import * as Sentry from "@sentry/node";
import type { Hono } from "hono";
import { agentSyncService } from "@/services/agent-sync.service";
// Imported from the module directly, not through agentSyncService: the
// service file sits at the size ceiling and the x402 readiness sync has no
// other reason to pass through it.
import { syncX402BuySideReadiness } from "@/services/agent-sync.x402-readiness";

import { handleSyncRequest } from "../handler.js";

export const AGENTS_SYNC_LOCK_KEY = "agents-sync";
// Projection versions use distinct cursor keys so old and new binaries cannot
// advance each other's cursors during a rolling deployment. Bump the suffix
// whenever already-synced registry rows require a full replay.
export const AGENTS_SYNC_METADATA_KEY =
  "agents-sync-metadata:dynamic-pricing-v1";
// ONE budget for BOTH readiness syncs — the comments below promise "the same
// timeout treatment", and a shared constant is what keeps a future tuning of
// one rail from silently leaving the other on a different deadline.
const READINESS_SYNC_TIMEOUT_MS = 10_000;

export default function mount(app: Hono) {
  app.get("/agents", async (c) => {
    const replayRequested = c.req.query("replay") === "true";
    return await handleSyncRequest(c, AGENTS_SYNC_LOCK_KEY, async (context) => {
      // Readiness first: it is cheap, independent of registry data, and must
      // not be starved by a long registry replay eating the time budget. The
      // hard 10s timeout keeps a hung payment node from pinning the lock.
      const readinessChanged =
        await agentSyncService.syncCardanoV2RailReadiness({
          signal: AbortSignal.any([
            context.abortSignal,
            AbortSignal.timeout(READINESS_SYNC_TIMEOUT_MS),
          ]),
        });
      // x402 buy-side readiness rides the same cron under the same timeout
      // treatment. Its change signal deliberately does NOT reset the registry
      // cursor: the x402 listing reads getX402ReadySources at request time,
      // so nothing readiness-dependent is baked into agent rows (unlike the
      // Cardano readiness, which feeds the projected availability filters).
      //
      // Isolated: x402 readiness is advisory, and the registry sync below is
      // this route's primary job. syncX402BuySideReadiness handles its own
      // failures internally (aborts and node errors land in its check-error
      // path and return false), so a throw reaching here is genuinely
      // exceptional — e.g. paymentClient() or getEnv() failing on
      // misconfiguration — and must not abort the registry sync: swallow it,
      // last-known readiness stays served, and the next cron retries.
      try {
        await syncX402BuySideReadiness({
          signal: AbortSignal.any([
            context.abortSignal,
            AbortSignal.timeout(READINESS_SYNC_TIMEOUT_MS),
          ]),
        });
      } catch (error) {
        console.warn(
          "[sync/agents] x402 buy-side readiness sync failed; continuing registry sync:",
          error,
        );
        // Report it too. Only paths that BYPASS the sync's own handled-failure
        // alerting land here, so a swallowed throw would otherwise leave the
        // stale cache serving "ready" with nothing louder than a log line —
        // exactly the outage the handled path pages for.
        Sentry.captureException(error, {
          tags: { x402_readiness: "sync_threw" },
        });
      }
      await agentSyncService.syncRegistryAgents(AGENTS_SYNC_METADATA_KEY, {
        abortSignal: context.abortSignal,
        shouldContinue: context.shouldContinue,
        ...(readinessChanged || replayRequested ? { resetCursor: true } : {}),
      });
    });
  });
}
