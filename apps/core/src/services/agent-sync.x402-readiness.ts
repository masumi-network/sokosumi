import * as Sentry from "@sentry/node";
import type {
  X402AvailableNetwork,
  X402KeySpendCaps,
  X402Wallet,
} from "@sokosumi/masumi";

import { paymentClient } from "@/clients/masumi-payment.client";
import { getEnv } from "@/config/env";
import {
  X402_BUY_SIDE_READINESS_FAILURE_KEY,
  X402_BUY_SIDE_READINESS_KEY,
} from "@/helpers/x402-readiness";
import prisma from "@/lib/db/prisma";

import {
  composeX402ReadySources,
  computeEnabledPricedNetworks,
  type PurchasingWalletWithBalances,
} from "./agent-sync.x402-readiness.compose";

/**
 * Ceilings for far-side error text echoed into logs and Sentry. Each check
 * error can be `extractNodeErrorMessage`'s stringify of an entire proxy
 * response body, and one cycle joins up to three endpoint errors plus one per
 * balance-fetched wallet — unbounded, that bloats the log line and lets the
 * Sentry SDK's own truncation drop every error after the first fat one. The
 * per-item cap keeps later errors visible; the total cap mirrors the pay
 * path's `MAX_NODE_MESSAGE_ECHO_LENGTH` in `task-x402-payment.service.ts`.
 */
const MAX_CHECK_ERROR_ITEM_LENGTH = 200;
const MAX_CHECK_ERROR_TOTAL_LENGTH = 2_000;

/**
 * Exported for tests only: the total cap is unreachable through the public
 * entry point without fabricating dozens of erring wallet balance fetches
 * (three endpoint errors item-capped cannot exceed it), so it is pinned here.
 */
export function boundCheckErrorForLogging(errors: readonly string[]): string {
  return errors
    .map((error) => error.slice(0, MAX_CHECK_ERROR_ITEM_LENGTH))
    .join("; ")
    .slice(0, MAX_CHECK_ERROR_TOTAL_LENGTH);
}

/**
 * Safe operator context for a successful node check that composes to zero
 * ready pairs. Never log API-key ids, RPC URLs, or facilitator credentials
 * anywhere in this service. Credit UNITS are logged in full because a unit is
 * `eip155:<chainId>:<asset>` — two public chain identifiers and nothing about
 * the key that holds it — and the unit is exactly what an operator must top
 * up. Amounts are reduced to a boolean: the balance is not needed to act, and
 * Sentry retains context far longer than operator logs.
 */
function summarizeEmptyX402Readiness(
  networks: readonly X402AvailableNetwork[],
  spendCaps: X402KeySpendCaps | null,
  purchasingWallets: readonly X402Wallet[],
) {
  return {
    networkCount: networks.length,
    networks: networks.slice(0, 20).map((network) => ({
      caip2Id: network.caip2Id,
      isEnabled: network.isEnabled,
      defaultAsset: network.defaultAsset,
      defaultAssetDecimals: network.defaultAssetDecimals,
    })),
    usageLimited: spendCaps?.usageLimited ?? null,
    grandfatheredUncapped: spendCaps?.grandfatheredUncapped ?? null,
    creditUnits: Array.from(spendCaps?.creditsByUnit ?? [])
      .slice(0, 20)
      .map(([unit, amount]) => ({ unit, hasRemaining: amount > 0n })),
    purchasingWalletCount: purchasingWallets.length,
    purchasingWalletNetworks: purchasingWallets
      .slice(0, 20)
      .map((wallet) => wallet.caip2Network),
    truncated:
      networks.length > 20 ||
      (spendCaps?.creditsByUnit.size ?? 0) > 20 ||
      purchasingWallets.length > 20,
  };
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
 * Accepted race: cross-instance ordering comes from the agents-sync
 * distributed lock, which is stealable after LOCK_TIMEOUT. A holder stalled
 * that long can commit straggler writes here (the DB writes deliberately take
 * no abort signal and do not re-check lock ownership — readiness is advisory
 * and must never crash the sync loop mid-write). Worst cases: a stale
 * cursorId served for one cycle (pay re-verifies against the node, so
 * money-safe), or one muted/spurious failure page until the next cycle
 * corrects the marker. Fencing every write on ownerToken is sync-lock-wide
 * work, not x402-specific; not worth the machinery for a one-cycle,
 * fail-closed window.
 *
 * Returns whether the ready source set CHANGED.
 */
export async function syncX402BuySideReadiness(
  options: { signal?: AbortSignal } = {},
): Promise<boolean> {
  // ONE client instance for the whole cycle: the spend caps read IS the
  // memoized `GET /api-key-status` the client already resolves, so this
  // costs one request, not two — separate instances would each fetch it.
  const nodeClient = paymentClient();
  const [networksResult, spendCapsResult, walletsResult] = await Promise.all([
    nodeClient.getX402AvailableNetworks({ signal: options.signal }),
    nodeClient.getX402KeySpendCaps({ signal: options.signal }),
    nodeClient.getX402PurchasingWallets({ signal: options.signal }),
  ]);

  const availableNetworks = networksResult.isOk() ? networksResult.value : [];
  const keySpendCaps = spendCapsResult.isOk() ? spendCapsResult.value : null;

  const walletsWithBalances: PurchasingWalletWithBalances[] = [];
  const walletBalanceErrors: string[] = [];
  if (networksResult.isOk() && spendCapsResult.isOk() && walletsResult.isOk()) {
    // EXACTLY the chains compose can turn into ready pairs — same helper,
    // not a hand-copied gate. A chain compose would refuse (untrusted
    // default asset, contradictory rows) must not have its wallets
    // balance-fetched: a flaky balance read on such a chain would fail the
    // whole check and keep serving a stale ready pair that a successful
    // check would have delisted.
    const balanceEligibleNetworks = new Set(
      [...computeEnabledPricedNetworks(availableNetworks, getEnv().NETWORK)]
        .filter(([, pricedAsset]) => pricedAsset !== null)
        .map(([caip2Network]) => caip2Network),
    );
    const balanceEligibleWallets = walletsResult.value.filter(
      (wallet) =>
        wallet.type === "Purchasing" &&
        balanceEligibleNetworks.has(wallet.caip2Network?.toLowerCase()),
    );
    const balanceResults = await Promise.all(
      balanceEligibleWallets.map(async (wallet) => ({
        wallet,
        result: await nodeClient.getX402WalletBalances(
          {
            evmWalletId: wallet.id,
            evmWalletAddress: wallet.address,
            caip2Network: wallet.caip2Network,
          },
          { signal: options.signal },
        ),
      })),
    );
    for (const { wallet, result } of balanceResults) {
      if (result.isErr()) {
        walletBalanceErrors.push(result.error);
      } else {
        walletsWithBalances.push({ wallet, balances: result.value });
      }
    }
  }

  const checkErrors = [
    ...(networksResult.isErr() ? [networksResult.error] : []),
    ...(spendCapsResult.isErr() ? [spendCapsResult.error] : []),
    ...(walletsResult.isErr() ? [walletsResult.error] : []),
    ...walletBalanceErrors,
  ];
  if (checkErrors.length > 0) {
    const checkError = boundCheckErrorForLogging(checkErrors);
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
      //
      // Preview deploys (VERCEL_ENV === "preview") still warn and write the
      // failure marker so fail-closed listing/pay behavior is unchanged, but
      // they must not page Sentry — preview mainnet crons with a non-admin
      // PAYMENT_API_KEY were flooding CORE-37 while live mainnet was fine.
      // Use VERCEL_ENV, not SENTRY_ENVIRONMENT (mainnet project sets the
      // latter to "production" on preview hosts too).
      if (
        getEnv().VERCEL_ENV !== "preview" &&
        (marker.count > 0 || hasNeverBeenRecorded)
      ) {
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

  const purchasingWallets = walletsResult.isOk() ? walletsResult.value : [];
  const readySources = composeX402ReadySources(
    availableNetworks,
    keySpendCaps,
    getEnv().NETWORK,
    walletsWithBalances,
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
    // changes still propagate; retry marker cleanup next time. Loud, not just
    // a log line: while the stale marker survives, the createMany latch above
    // reports count=0 for every NEW failure streak, so the next real outage
    // would page nobody. A cleanup failure is the alert channel silently
    // disarming itself.
    console.warn(
      "[sync/agents] Failed to clear x402 readiness failure marker:",
      cleanupError,
    );
    Sentry.captureException(cleanupError, {
      tags: { x402_readiness: "marker_cleanup_failed" },
    });
  }

  if (readySources.length === 0) {
    console.warn(
      "[sync/agents] No x402 (network, asset) pair is buy-side ready; fixed-price x402 agents stay unlisted and dynamic agents remain visible as non-payable previews",
    );
    console.warn(
      "[sync/agents] Empty x402 readiness inputs:",
      summarizeEmptyX402Readiness(
        availableNetworks,
        keySpendCaps,
        purchasingWallets,
      ),
    );
    // A successful check reporting ZERO ready pairs hides every payable x402
    // entry just as effectively as a failed check, so it must page too.
    // Authenticated callers may still discover dynamic agents, but the listing
    // marks them non-payable until a priced ready pair returns.
    // Page only on the transition so a lasting outage does not spam.
    if (readinessChanged) {
      Sentry.captureMessage(
        // The likeliest new cause is an operator one, not an outage: a chain
        // whose `defaultAssetDecimals` is still null publishes no scale, and
        // an unpriceable asset is deliberately not recorded ready.
        "x402 buy-side readiness reports no payable (network, asset) pair. Fixed-price x402 agents are hidden and dynamic agents are preview-only. Check four things. 1) The node publishes a confirmed defaultAssetDecimals for each enabled chain. 2) The chain is in this environment's CAIP-2 allowlist and its priced asset is in X402_TRUSTED_EXACT_EVM_DOMAINS (both in apps/core/src/helpers/x402-readiness.ts; the sync warn log names any untrusted pair). 3) The node lists at least one Purchasing wallet Soko's key can reach on that chain, funded with native gas and the priced token (the sync warn log names the chain when the listing is empty or every wallet is unfunded). 4) If Soko's key is usage limited, it holds remaining credits for unit <caip2Network>:<asset> on that chain; grant them with PATCH /api/v1/api-key. A usage-limited key with NO eip155 credit row at all is grandfathered uncapped by the node and stays payable, so an operator who expected a cap there has not set one",
        "error",
      );
    }
  }
  return readinessChanged;
}
