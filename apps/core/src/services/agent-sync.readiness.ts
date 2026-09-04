import * as Sentry from "@sentry/node";

import { paymentClient } from "@/clients/masumi-payment.client";
import {
  CARDANO_V2_RAIL_READINESS_FAILURE_KEY,
  CARDANO_V2_RAIL_READINESS_KEY,
  getCardanoV2ReadySources,
} from "@/helpers/agent";
import prisma from "@/lib/db/prisma";

/**
 * Refreshes the recorded Cardano V2 rail readiness of the payment node (read
 * by getCardanoV2ReadySources).
 *
 * On check failure the last known value is kept and a marker is written, so
 * readers keep serving it rather than losing the V2 catalog to an outage of
 * our own polling. That degradation is only graceful while the last known
 * value is a USABLE one. A recorded empty set hides the whole V2 catalogue as
 * completely as no recording at all, which is why the alert below takes its
 * SEVERITY from what readers are served. How OFTEN it may fire is a separate
 * question, and that one still turns on whether a row exists at all.
 *
 * Returns whether the purchase-ready source set CHANGED, which is what makes
 * the caller replay the registry — and, since a change from "nothing recorded"
 * to a ready source also lifts the ingestion rollback fence in
 * syncRegistryAgents, that replay is what first writes the V2 rows.
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
      // HOW BAD is it? Is a usable fallback actually being served? The two
      // cases degrade completely differently and must not share one alert.
      //
      // Ask the question readers ask. Row EXISTENCE answers a different
      // question and answers this one wrong: the success path upserts
      // whatever it got, so a tick where the node reported nothing ready
      // leaves a row holding "[]". That row hides the catalogue exactly as
      // completely as no row at all, and calling it "warm" would downgrade a
      // live outage to a warning and then latch it into silence.
      //
      // Hidden (no usable source): every V2 agent is unlistable and every V2
      // task payment 422s. That is an outage, and it is the state a fresh
      // environment, a deploy landing before the node serves /rail-readiness,
      // and a node reporting nothing purchase-ready all share.
      //
      // Stale (sources are being served): readers keep serving the last known
      // value, so a failed check costs nothing user-visible.
      const isCatalogueHidden =
        (await getCardanoV2ReadySources(prisma)).length === 0;

      // HOW OFTEN may it page is a separate question, and row existence is
      // the right answer to THIS one. A catalogue that was recorded and then
      // went empty already paged when it went empty, on the success path
      // below. Bypassing the latch for it as well would page every five
      // minutes for the length of an outage, which is the noise this change
      // exists to cut, not add to.
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
            isCatalogueHidden
              ? `Cardano V2 rail readiness has no usable value; the entire V2 catalogue is hidden. Last error: ${readinessResult.error}`
              : `Cardano V2 rail readiness check failed: ${readinessResult.error}`,
          ),
          {
            // Severity follows the user-visible impact, not the check result.
            // Hidden IS the outage: no V2 agent can be listed or paid right
            // now. Stale is not. Readers keep serving the last recorded
            // sources, the next cron tick is five minutes out, and the usual
            // cause is one timed-out attempt that costs nothing anybody can
            // see. Paging for that teaches people to skip the alert, which is
            // how the hidden case gets missed too. It stays reported, so a
            // lasting outage is still visible in the same place.
            level: isCatalogueHidden ? "error" : "warning",
            tags: {
              cardano_v2_readiness: isCatalogueHidden ? "hidden" : "stale",
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
