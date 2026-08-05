import * as Sentry from "@sentry/node";

import { paymentClient } from "@/clients/masumi-payment.client";
import { getEnv } from "@/config/env";
import {
  CARDANO_V2_RAIL_READINESS_FAILURE_KEY,
  CARDANO_V2_RAIL_READINESS_KEY,
  CARDANO_V2_RAIL_READINESS_TTL_MS,
} from "@/helpers/agent";
import { resetCardanoV2ReadySourcesCache } from "@/helpers/cardano-v2-readiness-cache";
import prisma from "@/lib/db/prisma";

/**
 * Refreshes the cached Cardano V2 rail readiness of the payment node (read by
 * getCardanoV2ReadySources). On check failure the last known value is kept —
 * its TTL fails closed during an extended outage.
 */
export async function syncCardanoV2RailReadiness(
  options: { signal?: AbortSignal } = {},
): Promise<boolean> {
  const isCardanoV2Enabled = getEnv().ENABLE_CARDANO_V2_AGENTS;
  // Nothing reads the cache while the flag is off (getCardanoV2ReadySources
  // short-circuits), so skip the node round-trip. After a flag flip the next
  // cron cycle populates the cache within 5 minutes.
  if (!isCardanoV2Enabled) {
    try {
      // Disabling the flag resets the Sentry dedupe latch so a re-enable
      // reports a fresh failure streak instead of inheriting an old marker.
      // Known trade-off: during a mixed-flag rollout a flag-off instance
      // wipes the latch every cycle, so a flag-on instance re-pages per cron
      // until the fleet converges — noise only, never a missed page.
      await prisma.syncMetadata.deleteMany({
        where: { key: CARDANO_V2_RAIL_READINESS_FAILURE_KEY },
      });
    } catch (cleanupError) {
      // Readiness bookkeeping must never crash the registry sync loop.
      console.warn(
        "[sync/agents] Failed to clear Cardano V2 readiness failure marker:",
        cleanupError,
      );
    }
    return false;
  }
  const readinessResult = await paymentClient().getCardanoV2RailReadiness({
    signal: options.signal,
  });

  if (readinessResult.isErr()) {
    console.warn(
      "[sync/agents] Cardano V2 rail readiness check failed:",
      readinessResult.error,
    );
    // The flag is known enabled here — the disabled branch returned above.
    try {
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
      if (marker.count > 0) {
        Sentry.captureException(
          new Error(
            `Cardano V2 rail readiness check failed: ${readinessResult.error}`,
          ),
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
    // A cache that had gone stale (TTL expired) fed [] to the availability and
    // pricing paths, so entries synced during that window were projected from
    // the fallback source rather than a purchase-ready one. Coming back with
    // the SAME source set is therefore still a change that must trigger a
    // replay.
    const wasReadinessStale =
      previousReadiness === null ||
      Date.now() - previousReadiness.lastSyncedAt.getTime() >=
        CARDANO_V2_RAIL_READINESS_TTL_MS;
    readinessChanged =
      previousReadiness?.cursorId !== serializedReadySources ||
      wasReadinessStale;
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
    // Drop the in-process memo so the registry replay that runs right after
    // this refresh — and any request served by this instance — projects
    // against the value just written, not the one read seconds earlier.
    resetCardanoV2ReadySourcesCache();
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
      "[sync/agents] No Cardano V2 source is purchase-ready; V2 agents stay unavailable despite ENABLE_CARDANO_V2_AGENTS",
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
