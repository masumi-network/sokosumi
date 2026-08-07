import * as Sentry from "@sentry/node";

import { paymentClient } from "@/clients/masumi-payment.client";
import {
  CARDANO_V2_RAIL_READINESS_FAILURE_KEY,
  CARDANO_V2_RAIL_READINESS_KEY,
} from "@/helpers/agent";
import prisma from "@/lib/db/prisma";

/**
 * Refreshes the recorded Cardano V2 rail readiness of the payment node (read
 * by getCardanoV2ReadySources). On check failure the last known value is kept
 * and a marker is written, so readers keep serving it rather than losing the
 * V2 catalog to an outage of our own polling.
 *
 * Returns whether the purchase-ready source set CHANGED, which is what makes
 * the caller replay the registry.
 */
export async function syncCardanoV2RailReadiness(
  options: { signal?: AbortSignal } = {},
): Promise<boolean> {
  const readinessResult = await paymentClient().getCardanoV2RailReadiness({
    signal: options.signal,
  });

  if (readinessResult.isErr()) {
    console.warn(
      "[sync/agents] Cardano V2 rail readiness check failed:",
      readinessResult.error,
    );
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
