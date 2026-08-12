import * as Sentry from "@sentry/node";
import type { X402AvailableNetwork, X402Budget } from "@sokosumi/masumi";
import {
  CAIP2_EVM_NETWORK_PATTERN,
  EVM_ADDRESS_PATTERN,
} from "@sokosumi/masumi";

import { paymentClient } from "@/clients/masumi-payment.client";
import { getEnv } from "@/config/env";
import { isUsableAssetDecimals } from "@/helpers/x402-pricing";
import {
  isX402NetworkAllowed,
  X402_BUY_SIDE_READINESS_FAILURE_KEY,
  X402_BUY_SIDE_READINESS_KEY,
  type X402ReadySource,
} from "@/helpers/x402-readiness";
import prisma from "@/lib/db/prisma";

/** The one asset on a chain whose scale the node vouches for. */
interface PricedNetworkAsset {
  /** Canonical lowercase ERC-20 contract address. */
  asset: string;
  /** Base units per whole token, straight from the node. */
  decimals: number;
}

/**
 * The node's `defaultAsset` for a chain together with its
 * `defaultAssetDecimals`, or `undefined` when the node vouches for neither.
 *
 * Both fields are required-but-NULLABLE in the pinned spec
 * (`defaultAssetDecimals` is documented as "null until an operator confirms
 * them"), so an absent scale is an ordinary node state, not a protocol
 * violation — it just makes the chain unpayable until the operator fills it
 * in. Returning `undefined` for a half-answer (asset without decimals, or the
 * reverse) keeps the pair from being recorded at all.
 */
function toPricedNetworkAsset(
  network: X402AvailableNetwork,
): PricedNetworkAsset | undefined {
  const asset = network.defaultAsset?.trim().toLowerCase();
  if (
    !asset ||
    !EVM_ADDRESS_PATTERN.test(asset) ||
    !isUsableAssetDecimals(network.defaultAssetDecimals)
  ) {
    return undefined;
  }
  return { asset, decimals: network.defaultAssetDecimals };
}

/**
 * Composes per-network x402 buy-side readiness from the node's
 * `GET /x402/networks/available` and `GET /x402/budgets` (ticket 011 Q5):
 * a (network, asset) pair is ready when the chain is enabled for x402, the
 * node publishes a usable scale for that asset, AND a budget in it still has
 * remaining spend. The budget rows are
 * already scoped to Soko's own API key by `getX402Budgets` (the node's
 * admin-gated list is otherwise unscoped, and `POST /x402/pay` only draws
 * on the calling key's budgets — a foreign key's budget must never mark a
 * pair ready). Each pair records the `evmWalletId` of its backing budget so
 * the pay route can sign without a per-payment budgets fetch; when several
 * budgets back a pair, the most-funded wallet wins. `canSettle` is
 * deliberately ignored — outbound (buy) wallets do not require a
 * facilitator, and gating the buy side on inbound settlement would hide
 * payable agents for no reason.
 *
 * Each pair also records the node's `defaultAssetDecimals` as the asset's
 * scale. That is the whole point of reading the networks response for more
 * than `isEnabled`: `decimals` scales the charge INVERSELY, and the only
 * other copy of it lives on the agent's own registry entry. Because the node
 * vouches for its DEFAULT asset only, a budget in any other asset is dropped
 * — unpriceable is unpayable (see the budget loop). One pair per chain is
 * therefore the ceiling today.
 *
 * `environment` is a parameter rather than a `getEnv()` read so this stays
 * pure. It applies the per-environment EVM allowlist
 * (`isX402NetworkAllowed`): Preprod may record testnet chains only,
 * production mainnet chains only. Without it, environment separation would
 * rest entirely on the node honouring `GET /x402/networks/available`'s
 * `query: { isTestnet }` — a node that ignores or misreads that filter would
 * put a real-funds mainnet pair into the Preprod cache. The pay path enforces
 * the same allowlist again in `verifyX402DemandAgainstAgentSources`; this is
 * listing correctness plus defence in depth.
 */
export function composeX402ReadySources(
  networks: readonly X402AvailableNetwork[],
  budgets: readonly X402Budget[],
  environment: "Preprod" | "Mainnet",
): X402ReadySource[] {
  // Enabled chain -> the ONE asset the node publishes a scale for, or `null`
  // when the node contradicted itself about that chain.
  const enabledNetworks = new Map<string, PricedNetworkAsset | null>();
  for (const network of networks) {
    // Normalize BEFORE validating and keying, mirroring the Cardano
    // readiness client: everything downstream compares lowercase, so a
    // mixed-case id from the node must not be silently dropped as invalid.
    const caip2Id = network.caip2Id?.toLowerCase();
    if (
      !network.isEnabled ||
      !caip2Id ||
      !CAIP2_EVM_NETWORK_PATTERN.test(caip2Id) ||
      !isX402NetworkAllowed(caip2Id, environment)
    ) {
      continue;
    }
    const pricedAsset = toPricedNetworkAsset(network) ?? null;
    if (!enabledNetworks.has(caip2Id)) {
      enabledNetworks.set(caip2Id, pricedAsset);
      continue;
    }
    // One chain listed twice is malformed. Where the two entries agree it is
    // a harmless repeat; where they disagree, picking either is picking a
    // charge scale at random — and one of the two is 10^n wrong. Poison the
    // chain instead.
    const recorded = enabledNetworks.get(caip2Id);
    if (
      recorded?.asset !== pricedAsset?.asset ||
      recorded?.decimals !== pricedAsset?.decimals
    ) {
      enabledNetworks.set(caip2Id, null);
    }
  }

  const readySources = new Map<
    string,
    { pair: X402ReadySource; remainingAmount: bigint }
  >();
  for (const budget of budgets) {
    const caip2Network = budget.caip2Network?.toLowerCase();
    const asset = budget.asset?.toLowerCase();
    // The wallet id is the node's opaque identifier — carried verbatim, no
    // case normalization.
    const evmWalletId = budget.evmWalletId;
    if (
      !caip2Network ||
      !asset ||
      !evmWalletId ||
      !EVM_ADDRESS_PATTERN.test(asset)
    ) {
      continue;
    }
    // Covers both "the chain is not enabled and allowed here" and "the node
    // vouches for no scale on it". The node publishes `defaultAssetDecimals`
    // for its DEFAULT asset only, so a budget in any OTHER asset has no
    // trustworthy `decimals` anywhere — the only other copy is on the agent's
    // own registry entry, which is exactly the input this field stops
    // trusting. An asset that cannot be priced safely is not buy-side ready,
    // so it drops. Today that costs nothing: each allowed chain lists exactly
    // the one USDC contract Soko pays in. The day a second asset is wanted,
    // the node has to publish ITS decimals — Soko must not guess them here.
    const pricedAsset = enabledNetworks.get(caip2Network);
    if (!pricedAsset || pricedAsset.asset !== asset) {
      continue;
    }
    if (!/^\d+$/.test(budget.remainingAmount)) {
      continue;
    }
    const remainingAmount = BigInt(budget.remainingAmount);
    if (remainingAmount <= 0n) {
      // An exhausted budget cannot sign — the pair is not payable NOW,
      // which is exactly what listed ⇒ payable promises.
      continue;
    }
    // Several budgets (wallets) can back one (network, asset) pair. Record
    // the one with the most remaining spend — the wallet most likely to
    // cover a demand at pay time — with the wallet id as a deterministic
    // tie-break so the recorded set is stable across syncs.
    const key = `${caip2Network}:${asset}`;
    const current = readySources.get(key);
    if (
      !current ||
      remainingAmount > current.remainingAmount ||
      (remainingAmount === current.remainingAmount &&
        evmWalletId.localeCompare(current.pair.evmWalletId) < 0)
    ) {
      readySources.set(key, {
        pair: {
          caip2Network,
          asset,
          evmWalletId,
          decimals: pricedAsset.decimals,
        },
        remainingAmount,
      });
    }
  }

  // At most one pair survives per allowed chain (only the node's default
  // asset is priceable), and each environment allows one chain today, so this
  // sort is a no-op right now. It stays because the allowlists are meant to
  // grow: the serialized array IS the change-detection key, so an order that
  // followed the node's budget order would flip the cache — and page — with
  // no readiness change behind it.
  return Array.from(readySources.values())
    .map(({ pair }) => pair)
    .sort((left, right) => {
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
    getEnv().NETWORK,
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
        // The likeliest new cause is an operator one, not an outage: a chain
        // whose `defaultAssetDecimals` is still null publishes no scale, and
        // an unpriceable asset is deliberately not recorded ready.
        "x402 buy-side readiness reports no payable (network, asset) pair; all x402 agents are hidden. Check that each enabled chain has a funded budget in its defaultAsset and a confirmed defaultAssetDecimals",
        "error",
      );
    }
  }
  return readinessChanged;
}
