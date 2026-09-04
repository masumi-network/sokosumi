import * as Sentry from "@sentry/node";

import { paymentClient } from "@/clients/masumi-payment.client";
import {
  CARDANO_V2_RAIL_READINESS_FAILURE_KEY,
  CARDANO_V2_RAIL_READINESS_KEY,
} from "@/helpers/agent";
import prisma from "@/lib/db/prisma";

/**
 * What one readiness attempt gets, and how many attempts a failing cycle may
 * spend.
 *
 * The attempt timeout is what a healthy payment node has to answer within.
 * The retry count is what a cycle may spend on a far side that fails FAST: a
 * refused connection, a DNS failure, a proxy 502. Those return in
 * milliseconds, so three retries cost almost nothing and turn a blip into a
 * non-event.
 *
 * A repeated TIMEOUT is the opposite. It costs the full attempt timeout every
 * time, so the caller's own deadline ends the loop long before the count
 * does. That is deliberate. The registry sync shares this cycle's budget and
 * must not be starved to keep retrying a node that is not answering.
 */
const READINESS_ATTEMPT_TIMEOUT_MS = 20_000;
const READINESS_MAX_ATTEMPTS = 4;

/**
 * Each attempt needs its OWN deadline. Reusing the caller's signal would hand
 * attempt two a timeout that already fired, so every retry would return
 * instantly and the count would be spent without a single extra request. The
 * caller's signal still rides along as the ceiling on the whole loop.
 */
function attemptSignal(outer: AbortSignal | undefined): AbortSignal {
  const attempt = AbortSignal.timeout(READINESS_ATTEMPT_TIMEOUT_MS);
  return outer ? AbortSignal.any([outer, attempt]) : attempt;
}

/**
 * Refreshes the recorded Cardano V2 rail readiness of the payment node (read
 * by getCardanoV2ReadySources).
 *
 * On check failure the last known value is kept and a marker is written, so
 * readers keep serving it rather than losing the V2 catalog to an outage of
 * our own polling. That graceful degradation only exists once a value HAS been
 * recorded — before then there is nothing to fall back on and the whole V2
 * catalogue is hidden, which is why the two cases alert differently.
 *
 * Returns whether the purchase-ready source set CHANGED, which is what makes
 * the caller replay the registry — and, since a change from "nothing recorded"
 * to a ready source also lifts the ingestion rollback fence in
 * syncRegistryAgents, that replay is what first writes the V2 rows.
 */
export async function syncCardanoV2RailReadiness(
  options: { signal?: AbortSignal } = {},
): Promise<boolean> {
  const node = paymentClient();
  let readinessResult = await node.getCardanoV2RailReadiness({
    signal: attemptSignal(options.signal),
  });
  for (
    let attempt = 2;
    attempt <= READINESS_MAX_ATTEMPTS &&
    readinessResult.isErr() &&
    !options.signal?.aborted;
    attempt += 1
  ) {
    console.warn(
      `[sync/agents] Cardano V2 rail readiness attempt ${attempt - 1} failed; retrying:`,
      readinessResult.error,
    );
    readinessResult = await node.getCardanoV2RailReadiness({
      signal: attemptSignal(options.signal),
    });
  }

  if (readinessResult.isErr()) {
    console.warn(
      "[sync/agents] Cardano V2 rail readiness check failed:",
      readinessResult.error,
    );
    try {
      // Has readiness EVER been recorded? The two cases degrade completely
      // differently and must not share one alert.
      //
      // Warm (a row exists): readers keep serving the last known value, so a
      // failed check costs nothing user-visible. One page is right — repeating
      // it for the length of an outage would be noise.
      //
      // Cold (no row): getCardanoV2ReadySources cannot tell "never recorded"
      // from "nothing ready" and returns [], which hides the ENTIRE V2
      // catalogue and 422s every V2 task payment. That is an outage, and it is
      // the state a fresh environment or a deploy landing before the node
      // serves /rail-readiness starts in.
      const recordedReadiness = await prisma.syncMetadata.findUnique({
        where: { key: CARDANO_V2_RAIL_READINESS_KEY },
        select: { key: true },
      });
      const hasNeverBeenRecorded = !recordedReadiness;

      // createMany + skipDuplicates is an atomic cross-instance latch:
      // exactly one serverless worker creates the marker and reports the
      // failure; later workers see count=0 until a successful check clears it.
      const marker = await prisma.syncMetadata.createMany({
        data: [
          {
            key: CARDANO_V2_RAIL_READINESS_FAILURE_KEY,
            cursorId: "failed",
            lastSyncedAt: new Date(),
          },
        ],
        skipDuplicates: true,
      });
      // The latch is deliberately bypassed while readiness has never been
      // recorded: silence would otherwise be indistinguishable from a healthy
      // deployment that simply has no V2 agents, and the single page that the
      // latch does allow is spent on the first tick — minutes after deploy,
      // long before anyone looks.
      if (marker.count > 0 || hasNeverBeenRecorded) {
        Sentry.captureException(
          new Error(
            hasNeverBeenRecorded
              ? `Cardano V2 rail readiness has never been recorded; the entire V2 catalogue is hidden. Last error: ${readinessResult.error}`
              : `Cardano V2 rail readiness check failed: ${readinessResult.error}`,
          ),
          {
            tags: {
              cardano_v2_readiness: hasNeverBeenRecorded
                ? "never_recorded"
                : "stale",
            },
          },
        );
      }
    } catch (markerError) {
      // Readiness is advisory and must never crash the registry sync loop.
      console.warn(
        "[sync/agents] Failed to persist Cardano V2 readiness failure marker:",
        markerError,
      );
    }
    return false;
  }

  const readySources = [...readinessResult.value].sort((left, right) => {
    const policyComparison = left.policyId.localeCompare(right.policyId);
    return policyComparison !== 0
      ? policyComparison
      : left.smartContractAddress.localeCompare(right.smartContractAddress);
  });
  const serializedReadySources = JSON.stringify(readySources);
  let readinessChanged: boolean;
  try {
    const previousReadiness = await prisma.syncMetadata.findUnique({
      where: { key: CARDANO_V2_RAIL_READINESS_KEY },
    });
    // A changed source set reprojects every V2 price, because pricing is
    // projected from the purchase-ready source. Age alone is not a change:
    // readers now always serve the last recorded value, so no window exists in
    // which they saw [] and projected against the fallback instead.
    // `undefined !== string` also covers the first run, when no row exists.
    readinessChanged = previousReadiness?.cursorId !== serializedReadySources;
    await prisma.syncMetadata.upsert({
      where: { key: CARDANO_V2_RAIL_READINESS_KEY },
      create: {
        key: CARDANO_V2_RAIL_READINESS_KEY,
        cursorId: serializedReadySources,
        lastSyncedAt: new Date(),
      },
      update: {
        cursorId: serializedReadySources,
        lastSyncedAt: new Date(),
      },
    });
  } catch (cacheError) {
    // Readiness is advisory and must never crash the registry sync loop. A
    // failed write leaves the old cache intact, so retry on the next cycle.
    console.warn(
      "[sync/agents] Failed to persist Cardano V2 rail readiness:",
      cacheError,
    );
    return false;
  }

  try {
    await prisma.syncMetadata.deleteMany({
      where: { key: CARDANO_V2_RAIL_READINESS_FAILURE_KEY },
    });
  } catch (cleanupError) {
    // Cache persistence already succeeded. Keep readinessChanged so source
    // changes still trigger a registry replay; retry marker cleanup next time.
    console.warn(
      "[sync/agents] Failed to clear Cardano V2 readiness failure marker:",
      cleanupError,
    );
  }

  if (readySources.length === 0) {
    console.warn(
      "[sync/agents] No Cardano V2 source is purchase-ready; V2 agents stay unavailable",
    );
    // A successful check reporting ZERO ready sources hides the entire V2
    // catalog just as effectively as a failed check, so it must page too —
    // only report on the transition, so a lasting outage does not spam.
    if (readinessChanged) {
      Sentry.captureMessage(
        "Cardano V2 rail reports no purchase-ready source; all V2 agents are hidden",
        "error",
      );
    }
  }
  return readinessChanged;
}
