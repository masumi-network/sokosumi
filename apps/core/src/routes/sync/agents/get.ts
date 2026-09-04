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
// The two readiness syncs no longer get the same treatment, because they no
// longer do the same thing: the Cardano sync retries a fast failure and owns
// its own ceiling (READINESS_BUDGET.totalTimeoutMs in
// agent-sync.readiness.ts, 25s), while the x402 sync makes one pass and is
// bounded from here.
//
// x402: a single pass, so this IS its attempt timeout. Deliberately left at
// the value both rails used to share. Nothing about the Cardano retry work
// asked for more here, and every second spent on this rail comes out of the
// same cycle budget as the registry sync below.
const X402_READINESS_SYNC_TIMEOUT_MS = 10_000;
//
// Both come out of the cycle budget, which is
// `max(LOCK_TIMEOUT - LOCK_TIMEOUT_BUFFER, MIN_SYNC_TIMEOUT_MS)` in
// handleSyncRequest, and the registry sync gets what is left. That budget is
// NOT one number: the Zod defaults in config/env.ts give 275s,
// apps/core/.env.example gives 95s, and the deployed value decides.
//
// Worst case for the two readiness LOOPS is 37s: 10s here, plus 27s for
// Cardano. Its node calls stop at its 25s ceiling; the 27s adds the last 2s
// backoff, because that wait is not abortable and a loop stopped inside one
// still finishes it. Neither figure bounds the sync: both then make a handful
// of Prisma writes that carry no deadline at all. So the registry sync keeps
// roughly 238s or 58s, not exactly.
//
// The case worth naming is a short LOCK_TIMEOUT. At its schema minimum of
// 60_000 with the DEFAULT buffer the budget is 35s, and 37s of readiness
// consumes it whole. (At both schema minimums, 60_000 and 1_000, the budget
// is 59s and 37s fits. The real floor is MIN_SYNC_TIMEOUT_MS, 1s, because
// LOCK_TIMEOUT_BUFFER has no upper bound.)
//
// What gets cut first is x402, not the registry sync. It runs second and
// inherits whatever the cron signal has left, so its reads abort early, and
// that abort lands in its own check-error path, which writes a failure marker
// and pages. The registry sync then does not run at all; it is cursor-based
// and resumable, so it loses a tick rather than failing, and only while the
// payment node is down. Raising readiness further, or lowering LOCK_TIMEOUT
// toward its minimum, needs that traded off deliberately.

export default function mount(app: Hono) {
  app.get("/agents", async (c) => {
    const replayRequested = c.req.query("replay") === "true";
    return await handleSyncRequest(c, AGENTS_SYNC_LOCK_KEY, async (context) => {
      // Readiness first: it is cheap, independent of registry data, and must
      // not be starved by a long registry replay eating the time budget. It
      // needs no ceiling from here: the sync owns one that already covers its
      // retries, so a hung payment node cannot pin the lock either way.
      const readinessChanged =
        await agentSyncService.syncCardanoV2RailReadiness({
          signal: context.abortSignal,
        });
      // x402 buy-side readiness rides the same cron under its own ceiling
      // above. Its change signal deliberately does NOT reset the registry
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
            AbortSignal.timeout(X402_READINESS_SYNC_TIMEOUT_MS),
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
