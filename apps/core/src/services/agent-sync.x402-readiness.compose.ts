import type {
  X402AvailableNetwork,
  X402KeySpendCaps,
  X402Wallet,
  X402WalletBalance,
} from "@sokosumi/masumi";
import {
  CAIP2_EVM_NETWORK_PATTERN,
  EVM_ADDRESS_PATTERN,
} from "@sokosumi/masumi";

import { isUsableAssetDecimals } from "@/helpers/x402-pricing";
import {
  getTrustedX402ExactEvmDomain,
  isX402NetworkAllowed,
  trimEvmWalletId,
  type X402ReadySource,
} from "@/helpers/x402-readiness";

/** The one asset on a chain whose scale the node vouches for. */
interface PricedNetworkAsset {
  /** Canonical lowercase ERC-20 contract address. */
  asset: string;
  /** Base units per whole token, straight from the node. */
  decimals: number;
}

export interface PurchasingWalletWithBalances {
  wallet: X402Wallet;
  balances: readonly X402WalletBalance[];
}

function hasPositiveBaseUnitBalance(amount: unknown): boolean {
  return (
    typeof amount === "string" && /^\d+$/.test(amount) && BigInt(amount) > 0n
  );
}

/**
 * The wallet's spendable balance of the chain's priced token, or null when it
 * cannot back a payment at all.
 *
 * Returns the amount rather than a boolean because the caller now picks the
 * most-funded wallet: with the spend cap moved onto the API key, nothing
 * binds a chain to one wallet, so "which wallet" is a ranking, not a lookup.
 *
 * Null covers every unusable shape: no balance row for the chain, more than
 * one (ambiguous, so fail closed), a fetch that errored, no native gas (token
 * funds cannot settle without it), a different asset, a scale disagreeing
 * with the node's published one, or a zero token balance.
 */
function readPricedTokenBalance(
  walletState: PurchasingWalletWithBalances,
  caip2Network: string,
  pricedAsset: PricedNetworkAsset,
): bigint | null {
  const matchingBalances = walletState.balances.filter(
    (candidate) =>
      candidate.caip2Network.toLowerCase() === caip2Network &&
      candidate.error === null,
  );
  if (matchingBalances.length !== 1) {
    return null;
  }
  const [balance] = matchingBalances;
  if (
    !hasPositiveBaseUnitBalance(balance.native?.amount) ||
    balance.asset?.asset.toLowerCase() !== pricedAsset.asset ||
    balance.asset.decimals !== pricedAsset.decimals ||
    !hasPositiveBaseUnitBalance(balance.asset.amount)
  ) {
    return null;
  }
  return BigInt(balance.asset.amount);
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
 * Enabled chain → the ONE trusted, priced asset the node publishes for it,
 * or `null` when the chain is poisoned (see below). A chain absent from the
 * map is unknown or disabled-only; a `null` value records "this chain
 * exists but must not be used".
 *
 * Shared by `composeX402ReadySources` AND the sync's balance-eligibility
 * sweep — deliberately one function, not two hand-kept copies. When the
 * sweep's gate was a hand-copied subset (it omitted the trusted-domain
 * check and the duplicate poisoning), a chain compose would refuse still
 * had its wallets balance-fetched, and any error from those fetches failed
 * the whole check — so the STALE previously-ready pair kept being served
 * precisely when the current node state would have delisted it.
 *
 * Contradiction handling: a chain listed twice is malformed. Where the
 * repeats agree it is a harmless repeat; where they disagree — on the
 * priced asset, its scale, or on `isEnabled` itself — picking either is
 * picking a charge scale (or an enablement) at random, so the chain is
 * poisoned. A disabled-only chain is simply not recorded.
 *
 * The `isEnabled` arm is a deliberate trade-off. The node does not
 * document a uniqueness constraint on `caip2Id`, so an operator who
 * "rotates" a chain by creating a second row and disabling the old one
 * would trip this poison and DELIST the chain until the stale row is
 * deleted. That failure is chosen on purpose: it costs availability (with
 * a Sentry page via the readiness change), never a mischarge — whereas
 * honoring row order would mark a possibly-disabled chain ready and burn a
 * charge-then-refund cycle per pay attempt. Operators must delete replaced
 * rows, not leave them disabled.
 */
export function computeEnabledPricedNetworks(
  networks: readonly X402AvailableNetwork[],
  environment: "Preprod" | "Mainnet",
): Map<string, PricedNetworkAsset | null> {
  const enabledNetworks = new Map<string, PricedNetworkAsset | null>();
  // Chains seen disabled, tracked separately so a disabled duplicate of an
  // enabled chain poisons it regardless of which row arrives first.
  const disabledNetworks = new Set<string>();
  for (const network of networks) {
    // Normalize BEFORE validating and keying, mirroring the Cardano
    // readiness client: everything downstream compares lowercase, so a
    // mixed-case id from the node must not be silently dropped as invalid.
    const caip2Id = network.caip2Id?.toLowerCase();
    if (
      !caip2Id ||
      !CAIP2_EVM_NETWORK_PATTERN.test(caip2Id) ||
      !isX402NetworkAllowed(caip2Id, environment)
    ) {
      continue;
    }
    if (!network.isEnabled) {
      disabledNetworks.add(caip2Id);
      if (enabledNetworks.has(caip2Id)) {
        enabledNetworks.set(caip2Id, null);
      }
      continue;
    }
    if (disabledNetworks.has(caip2Id)) {
      enabledNetworks.set(caip2Id, null);
      continue;
    }
    const candidateAsset = toPricedNetworkAsset(network);
    let pricedAsset: PricedNetworkAsset | null = null;
    if (candidateAsset !== undefined) {
      if (
        getTrustedX402ExactEvmDomain(caip2Id, candidateAsset.asset) !== null
      ) {
        pricedAsset = candidateAsset;
      } else {
        // Unlike a null `defaultAssetDecimals` (an ordinary node state the
        // operator fixes node-side), this gap is SOKO-side: the node vouches
        // for a priced chain and only the deployment's own
        // X402_TRUSTED_EXACT_EVM_DOMAINS map is missing the entry. Silent,
        // it is indistinguishable from "node not ready" — so name the exact
        // pair. Chain/asset ids are public; runs at cron cadence (twice per
        // sync: compose + balance-eligibility sweep), so volume is bounded.
        console.warn(
          `[sync/agents] x402 chain ${caip2Id} is enabled and priced (${candidateAsset.asset}) but has no trusted EIP-712 domain; add it to X402_TRUSTED_EXACT_EVM_DOMAINS (apps/core/src/helpers/x402-readiness.ts) to make it payable`,
        );
      }
    }
    if (!enabledNetworks.has(caip2Id)) {
      enabledNetworks.set(caip2Id, pricedAsset);
      continue;
    }
    const recorded = enabledNetworks.get(caip2Id);
    if (
      recorded?.asset !== pricedAsset?.asset ||
      recorded?.decimals !== pricedAsset?.decimals
    ) {
      enabledNetworks.set(caip2Id, null);
    }
  }
  return enabledNetworks;
}

/**
 * The (network, asset) pairs the payment node can pay on RIGHT NOW.
 *
 * Inputs: `GET /x402/networks/available`, the calling key's spend caps from
 * `GET /api-key-status`, and `GET /x402/wallets` with each candidate wallet's
 * live balances.
 *
 * A pair is ready only when all four hold.
 *
 * 1. The chain is enabled, allowed in this environment's CAIP-2 allowlist,
 *    and the node publishes a usable `defaultAssetDecimals` for its default
 *    asset. The node vouches for its DEFAULT asset only, so no other asset
 *    has a trustworthy scale anywhere: unpriceable is unpayable.
 * 2. Its priced asset has a trusted EIP-712 domain. Resource-server `extra`
 *    is attacker-authored and must never define the domain Soko signs under.
 * 3. Some Purchasing wallet the key can reach on that chain holds native gas
 *    AND the priced token.
 * 4. The key's spend cap allows it.
 *
 * On (4), masumi ADR 0016: the node caps x402 spend on the API KEY, not on a
 * wallet. `usageLimited` off means uncapped. On, it requires a positive
 * balance for unit `<caip2Network>:<asset>`, byte-identical to this pair
 * key, which is why the gate is a map lookup. There is no exception for a key
 * holding no `eip155:` row at all. The node used to grandfather such a key to
 * uncapped spend, which is why this gate once let it through; the node now
 * refuses its payments, so listing the pair would advertise an agent that
 * cannot be hired.
 * The gate asks whether the unit holds credit, never whether it holds enough:
 * no price exists at sync time, so a nearly exhausted unit stays listed and
 * the node refuses the charge with a 402 instead.
 *
 * On (3), any funded wallet is an equally valid signer now that the cap is
 * key-global: nothing binds a chain's spend to one wallet any more. The
 * most-funded wallet wins as the likeliest to cover a demand at pay time,
 * with the wallet id as a deterministic tie-break so the recorded set is
 * stable across syncs. Code-unit comparison, not localeCompare: the recorded
 * pair feeds the serialized change-detection key, and locale/ICU differences
 * between instances must not flip which wallet wins and page on every cycle.
 *
 * Fails closed everywhere. Absent spend caps, an empty wallet listing, an
 * unfunded wallet, and an exhausted credit unit each drop the pair, and the
 * per-chain warns name which one it was.
 *
 * There is deliberately no check of the key's own CAIP-2 chain limit. The
 * node applies that limit to `GET /x402/networks/available` itself (the same
 * `caip2NetworkLimit` its pay handler applies), so a chain the key may not
 * touch never reaches this function's input at all.
 *
 * The environment allowlist is enforced again on the pay path in
 * `verifyX402DemandAgainstAgentSources`; this is listing correctness plus
 * defence in depth, so a real-funds mainnet pair cannot enter a Preprod
 * cache.
 */
export function composeX402ReadySources(
  networks: readonly X402AvailableNetwork[],
  spendCaps: X402KeySpendCaps | null,
  environment: "Preprod" | "Mainnet",
  purchasingWallets: readonly PurchasingWalletWithBalances[] = [],
): X402ReadySource[] {
  const enabledNetworks = computeEnabledPricedNetworks(networks, environment);

  // A wallet id is the node's primary key, so two rows sharing one is a
  // malformed listing. It matters because the recorded pair carries an id AND
  // the address the pay path binds the signed payer to: taking those from an
  // arbitrary one of two rows can pair the id with the other row's address,
  // and every payment on that pair then fails the payer check. Poison the id
  // rather than picking.
  const idCounts = new Map<string, number>();
  for (const { wallet } of purchasingWallets) {
    const walletId = trimEvmWalletId(wallet.id);
    if (walletId) {
      idCounts.set(walletId, (idCounts.get(walletId) ?? 0) + 1);
    }
  }

  const walletsByNetwork = new Map<string, PurchasingWalletWithBalances[]>();
  for (const walletState of purchasingWallets) {
    const { wallet } = walletState;
    const caip2Network = wallet.caip2Network?.toLowerCase();
    const walletId = trimEvmWalletId(wallet.id);
    if (
      wallet.type !== "Purchasing" ||
      !caip2Network ||
      !walletId ||
      (idCounts.get(walletId) ?? 0) > 1
    ) {
      continue;
    }
    const wallets = walletsByNetwork.get(caip2Network) ?? [];
    wallets.push(walletState);
    walletsByNetwork.set(caip2Network, wallets);
  }

  const readySources: X402ReadySource[] = [];
  for (const [caip2Network, pricedAsset] of enabledNetworks) {
    if (!pricedAsset) {
      continue;
    }
    const pairLabel = `${caip2Network}:${pricedAsset.asset}`;

    // Fail closed: a cycle that could not read the cap must not compose a
    // pair as payable. The sync already fails its check step on this, so
    // reaching here means a caller composed without caps.
    if (!spendCaps) {
      continue;
    }
    if (spendCaps.usageLimited) {
      // Presence, not sufficiency. The node debits by comparing the SUM of
      // the unit's credit rows against the payment amount, while readiness
      // runs before any price is known. A unit holding one base unit still
      // lists the pair, and the node can still refuse the charge with a 402.
      // Listing cannot close that gap: a post-charge 402 on a listed pair
      // is the expected shape of an almost-empty credit unit.
      const remaining = spendCaps.creditsByUnit.get(pairLabel) ?? 0n;
      if (remaining <= 0n) {
        console.warn(
          `[sync/agents] x402 pair ${pairLabel} has no remaining usage credits on Soko's payment-node API key, so it cannot be buy-side ready. Grant credits for unit ${pairLabel} with PATCH /api/v1/api-key, or clear usageLimited on the key`,
        );
        continue;
      }
    }

    let best: {
      evmWalletId: string;
      evmWalletAddress: string;
      amount: bigint;
    } | null = null;
    for (const walletState of walletsByNetwork.get(caip2Network) ?? []) {
      const amount = readPricedTokenBalance(
        walletState,
        caip2Network,
        pricedAsset,
      );
      if (amount === null) {
        continue;
      }
      // Opaque and case-sensitive, so trim only. Whitespace-only cannot sign.
      const evmWalletId = trimEvmWalletId(walletState.wallet.id);
      const evmWalletAddress = walletState.wallet.address?.toLowerCase() ?? "";
      if (!evmWalletId || !EVM_ADDRESS_PATTERN.test(evmWalletAddress)) {
        continue;
      }
      if (
        !best ||
        amount > best.amount ||
        (amount === best.amount && evmWalletId < best.evmWalletId)
      ) {
        best = { evmWalletId, evmWalletAddress, amount };
      }
    }
    if (!best) {
      console.warn(
        `[sync/agents] x402 pair ${pairLabel} has no usable Purchasing wallet, so it cannot be buy-side ready. The node's listing exposes none that Soko's key can reach on this chain, or none holding both native gas and the priced token; create, scope, and fund one`,
      );
      continue;
    }

    readySources.push({
      caip2Network,
      asset: pricedAsset.asset,
      evmWalletId: best.evmWalletId,
      evmWalletAddress: best.evmWalletAddress,
      decimals: pricedAsset.decimals,
    });
  }

  // At most one pair survives per allowed chain (only the node's default
  // asset is priceable), and each environment allows one chain today, so this
  // sort is a no-op right now. It stays because the allowlists are meant to
  // grow: the serialized array IS the change-detection key, so an unstable
  // order would flip the cache, and the page with it, on no readiness change
  // it. Code-unit order, not localeCompare, for the same reason: localeCompare
  // depends on the host's ICU build and default locale, so two Core instances
  // could disagree and alternately rewrite the cache every cycle.
  //
  // NOTE: multi-pair output is untestable today, because compose refuses every chain
  // outside the one-entry allowlist, so no input reaches this comparator with
  // two pairs. Whoever grows the allowlist must add multi-pair compose/sort
  // tests in the same change.
  return readySources.sort((left, right) => {
    if (left.caip2Network !== right.caip2Network) {
      return left.caip2Network < right.caip2Network ? -1 : 1;
    }
    if (left.asset !== right.asset) {
      return left.asset < right.asset ? -1 : 1;
    }
    return 0;
  });
}
