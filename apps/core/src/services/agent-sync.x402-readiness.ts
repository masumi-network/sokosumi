import * as Sentry from "@sentry/node";
import type { X402AvailableNetwork, X402Budget } from "@sokosumi/masumi";
import {
  CAIP2_EVM_NETWORK_PATTERN,
  EVM_ADDRESS_PATTERN,
} from "@sokosumi/masumi";

import { paymentClient } from "@/clients/masumi-payment.client";
import {
  X402_BUY_SIDE_READINESS_FAILURE_KEY,
  X402_BUY_SIDE_READINESS_KEY,
  type X402ReadySource,
} from "@/helpers/x402-readiness";
import prisma from "@/lib/db/prisma";

/**
 * Composes per-network x402 buy-side readiness from the node's
 * `GET /x402/networks/available` and `GET /x402/budgets` (ticket 011 Q5):
 * a (network, asset) pair is ready when the chain is enabled for x402 AND a
 * budget in that asset still has remaining spend. `canSettle` is
 * deliberately ignored — outbound (buy) wallets do not require a
 * facilitator, and gating the buy side on inbound settlement would hide
 * payable agents for no reason.
 */
export function composeX402ReadySources(
  networks: readonly X402AvailableNetwork[],
  budgets: readonly X402Budget[],
): X402ReadySource[] {
  const enabledNetworks = new Set<string>();
  for (const network of networks) {
    // Normalize BEFORE validating and keying, mirroring the Cardano
    // readiness client: everything downstream compares lowercase, so a
    // mixed-case id from the node must not be silently dropped as invalid.
    const caip2Id = network.caip2Id?.toLowerCase();
    if (
      network.isEnabled &&
      caip2Id &&
      CAIP2_EVM_NETWORK_PATTERN.test(caip2Id)
    ) {
      enabledNetworks.add(caip2Id);
    }
  }

  const readySources = new Map<string, X402ReadySource>();
  for (const budget of budgets) {
    const caip2Network = budget.caip2Network?.toLowerCase();
    const asset = budget.asset?.toLowerCase();
    if (
      !caip2Network ||
      !asset ||
      !enabledNetworks.has(caip2Network) ||
      !EVM_ADDRESS_PATTERN.test(asset)
    ) {
      continue;
    }
    if (!/^\d+$/.test(budget.remainingAmount)) {
      continue;
    }
    if (BigInt(budget.remainingAmount) <= 0n) {
      // An exhausted budget cannot sign — the pair is not payable NOW,
      // which is exactly what listed ⇒ payable promises.
      continue;
    }
    readySources.set(`${caip2Network}:${asset}`, { caip2Network, asset });
  }

  return Array.from(readySources.values()).sort((left, right) => {
    const networkComparison = left.caip2Network.localeCompare(
      right.caip2Network,
    );
    return networkComparison !== 0
      ? networkComparison
      : left.asset.localeCompare(right.asset);
  });
}

/**
 * Refreshes the recorded x402 buy-side readiness of the payment node (read
 * by getX402ReadySources). Mirrors syncCardanoV2RailReadiness exactly:
 *
 * On check failure the last known value is kept and a marker is written, so
 * readers keep serving it rather than losing the x402 listing to an outage
 * of our own polling. That graceful degradation only exists once a value HAS
 * been recorded — before then there is nothing to fall back on and the whole
 * x402 listing is hidden (fail closed), which is why the two cases alert
 * differently.
 *
 * Returns whether the ready source set CHANGED.
 */
export async function syncX402BuySideReadiness(
  options: { signal?: AbortSignal } = {},
): Promise<boolean> {
  const [networksResult, budgetsResult] = await Promise.all([
    paymentClient().getX402AvailableNetworks({ signal: options.signal }),
    paymentClient().getX402Budgets({ signal: options.signal }),
  ]);

  if (networksResult.isErr() || budgetsResult.isErr()) {
    const checkError = [networksResult, budgetsResult]
      .filter((result) => result.isErr())
      .map((result) => (result.isErr() ? result.error : ""))
      .join("; ");
    console.warn(
      "[sync/agents] x402 buy-side readiness check failed:",
      checkError,
    );
    try {
      // Has readiness EVER been recorded? The two cases degrade completely
      // differently and must not share one alert.
      //
      // Warm (a row exists): readers keep serving the last known value, so a
      // failed check costs nothing user-visible. One page is right —
      // repeating it for the length of an outage would be noise.
      //
      // Cold (no row): getX402ReadySources cannot tell "never recorded" from
      // "nothing ready" and returns [], which hides the ENTIRE x402 listing
      // and rejects every x402 payment. That is an outage, and it is the
      // state a fresh environment starts in.
      const recordedReadiness = await prisma.syncMetadata.findUnique({
        where: { key: X402_BUY_SIDE_READINESS_KEY },
        select: { key: true },
      });
      const hasNeverBeenRecorded = !recordedReadiness;

      // createMany + skipDuplicates is an atomic cross-instance latch:
      // exactly one worker creates the marker and reports the failure; later
      // workers see count=0 until a successful check clears it.
      const marker = await prisma.syncMetadata.createMany({
        data: [
          {
            key: X402_BUY_SIDE_READINESS_FAILURE_KEY,
            cursorId: "failed",
            lastSyncedAt: new Date(),
          },
        ],
        skipDuplicates: true,
      });
      // The latch is deliberately bypassed while readiness has never been
      // recorded: silence would otherwise be indistinguishable from a
      // healthy deployment that simply has no x402 agents.
      if (marker.count > 0 || hasNeverBeenRecorded) {
        Sentry.captureException(
          new Error(
            hasNeverBeenRecorded
              ? `x402 buy-side readiness has never been recorded; the entire x402 listing is hidden. Last error: ${checkError}`
              : `x402 buy-side readiness check failed: ${checkError}`,
          ),
          {
            tags: {
              x402_readiness: hasNeverBeenRecorded ? "never_recorded" : "stale",
            },
          },
        );
      }
    } catch (markerError) {
      // Readiness is advisory and must never crash the sync loop.
      console.warn(
        "[sync/agents] Failed to persist x402 readiness failure marker:",
        markerError,
      );
    }
    return false;
  }

  const readySources = composeX402ReadySources(
    networksResult.value,
    budgetsResult.value,
  );
  const serializedReadySources = JSON.stringify(readySources);
  let readinessChanged: boolean;
  try {
    const previousReadiness = await prisma.syncMetadata.findUnique({
      where: { key: X402_BUY_SIDE_READINESS_KEY },
    });
    // Age alone is not a change: readers always serve the last recorded
    // value. `undefined !== string` also covers the first run.
    readinessChanged = previousReadiness?.cursorId !== serializedReadySources;
    await prisma.syncMetadata.upsert({
      where: { key: X402_BUY_SIDE_READINESS_KEY },
      create: {
        key: X402_BUY_SIDE_READINESS_KEY,
        cursorId: serializedReadySources,
        lastSyncedAt: new Date(),
      },
      update: {
        cursorId: serializedReadySources,
        lastSyncedAt: new Date(),
      },
    });
  } catch (cacheError) {
    // Readiness is advisory and must never crash the sync loop. A failed
    // write leaves the old cache intact, so retry on the next cycle.
    console.warn(
      "[sync/agents] Failed to persist x402 buy-side readiness:",
      cacheError,
    );
    return false;
  }

  try {
    await prisma.syncMetadata.deleteMany({
      where: { key: X402_BUY_SIDE_READINESS_FAILURE_KEY },
    });
  } catch (cleanupError) {
    // Cache persistence already succeeded. Keep readinessChanged so source
    // changes still propagate; retry marker cleanup next time.
    console.warn(
      "[sync/agents] Failed to clear x402 readiness failure marker:",
      cleanupError,
    );
  }

  if (readySources.length === 0) {
    console.warn(
      "[sync/agents] No x402 (network, asset) pair is buy-side ready; x402 agents stay unlisted",
    );
    // A successful check reporting ZERO ready pairs hides the entire x402
    // listing just as effectively as a failed check, so it must page too —
    // only on the transition, so a lasting outage does not spam.
    if (readinessChanged) {
      Sentry.captureMessage(
        "x402 buy-side readiness reports no payable (network, asset) pair; all x402 agents are hidden",
        "error",
      );
    }
  }
  return readinessChanged;
}
