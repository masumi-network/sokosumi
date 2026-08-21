import type {
  X402AvailableNetwork,
  X402Budget,
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

export interface AdminPurchasingWalletWithBalances {
  wallet: X402Wallet;
  balances: readonly X402WalletBalance[];
}

function hasPositiveBaseUnitBalance(amount: unknown): boolean {
  return (
    typeof amount === "string" && /^\d+$/.test(amount) && BigInt(amount) > 0n
  );
}

function hasRequiredWalletBalances(
  walletState: AdminPurchasingWalletWithBalances,
  caip2Network: string,
  pricedAsset: PricedNetworkAsset,
): boolean {
  const matchingBalances = walletState.balances.filter(
    (candidate) =>
      candidate.caip2Network.toLowerCase() === caip2Network &&
      candidate.error === null,
  );
  if (matchingBalances.length !== 1) {
    return false;
  }
  const [balance] = matchingBalances;
  return (
    hasPositiveBaseUnitBalance(balance.native?.amount) &&
    balance.asset?.asset.toLowerCase() === pricedAsset.asset &&
    balance.asset.decimals === pricedAsset.decimals &&
    hasPositiveBaseUnitBalance(balance.asset.amount)
  );
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
 * Composes per-network x402 buy-side readiness from the node's
 * `GET /x402/networks/available`, `GET /x402/budgets`, and — for a confirmed
 * admin key only — `GET /x402/wallets` plus
 * `GET /x402/wallets/balance` (ticket 011 Q5). A (network, asset)
 * pair is ready when the chain is enabled for x402, the node publishes a
 * usable scale for that asset, and its selected Purchasing wallet has native
 * gas plus a positive matching-token balance. A budget path additionally
 * needs remaining spend; an uncapped admin fallback additionally needs one
 * unambiguous Purchasing wallet on the chain.
 *
 * BOTH inputs are admin-gated on the payment node, so a non-admin key never
 * reaches this compose at all: `GET /x402/budgets` rejects a plain pay key
 * outright (see the client doc on `getX402Budgets`), the readiness sync
 * fails its check step, and the deployment surfaces as "readiness check
 * failed" — not as an empty cache. The wallet binding below is money-safety,
 * not admin detection: a budget row alone never marks a pair ready — it must
 * bind to a listed Purchasing wallet and that wallet's live balances. The
 * reachable failures this leaves are a listing with no usable Purchasing
 * wallet at all, and a configured budget that cannot back its pair — an
 * unbindable wallet reference, or a budget spent to zero — with no sibling
 * budget covering the pair; the per-pair warns after the budget loop and the
 * empty-listing warn name them.
 * The budget rows are
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
  adminPurchasingWallets: readonly AdminPurchasingWalletWithBalances[] = [],
): X402ReadySource[] {
  const enabledNetworks = computeEnabledPricedNetworks(networks, environment);

  const readySources = new Map<
    string,
    { pair: X402ReadySource; remainingAmount: bigint }
  >();
  // Budget readiness must bind to a real Purchasing wallet returned by the
  // node and to that wallet's live balances. Duplicate ids are ambiguous and
  // poisoned rather than letting response order choose the signer.
  const walletStatesById = new Map<
    string,
    AdminPurchasingWalletWithBalances | null
  >();
  for (const walletState of adminPurchasingWallets) {
    const { wallet } = walletState;
    const walletId = trimEvmWalletId(wallet.id);
    if (wallet.type !== "Purchasing" || !walletId) {
      continue;
    }
    walletStatesById.set(
      walletId,
      walletStatesById.has(walletId) ? null : walletState,
    );
  }
  // An existing budget is binding even for an admin: payment-node semantics
  // reject an underfunded configured budget instead of falling through to
  // uncapped owner access. Track presence separately from positive balance so
  // the admin fallback below cannot bypass an exhausted cap.
  const configuredBudgetPairs = new Set<string>();
  // Budget rows that could not back their pair, warned AFTER the loop and
  // only when the pair ends unready: several budgets may back one pair, so a
  // row-level warn would cry wolf on a healthy deployment that still carries
  // a stale or spent second row.
  const budgetRowIssues: {
    pairKey: string;
    caip2Network: string;
    asset: string;
    evmWalletId: string;
    issue: "unbindable" | "exhausted";
  }[] = [];
  for (const budget of budgets) {
    const caip2Network = budget.caip2Network?.toLowerCase();
    const asset = budget.asset?.toLowerCase();
    // Opaque and case-sensitive — trim only. Whitespace-only cannot sign.
    const evmWalletId = trimEvmWalletId(budget.evmWalletId ?? "");
    const evmWalletAddress = budget.evmWalletAddress?.toLowerCase();
    if (
      !caip2Network ||
      !asset ||
      !evmWalletId ||
      !evmWalletAddress ||
      !EVM_ADDRESS_PATTERN.test(evmWalletAddress) ||
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
    // Any configured budget binds this pair. If its referenced wallet is
    // absent, retired, non-Purchasing, or unfunded, do not silently switch to
    // another wallet's uncapped admin path.
    configuredBudgetPairs.add(`${caip2Network}:${asset}`);
    const walletState = walletStatesById.get(evmWalletId);
    if (
      !walletState ||
      walletState.wallet.caip2Network.toLowerCase() !== caip2Network ||
      walletState.wallet.address.toLowerCase() !== evmWalletAddress ||
      !hasRequiredWalletBalances(walletState, caip2Network, pricedAsset)
    ) {
      // The empty-listing warn below covers `walletStatesById.size === 0`;
      // this row is only worth naming when the listing HAS usable wallets,
      // just not the one this budget is bound to (absent or retired,
      // duplicate id, mismatched chain or address, or unfunded).
      if (walletStatesById.size > 0) {
        budgetRowIssues.push({
          pairKey: `${caip2Network}:${asset}`,
          caip2Network,
          asset,
          evmWalletId,
          issue: "unbindable",
        });
      }
      continue;
    }
    if (!/^\d+$/.test(budget.remainingAmount)) {
      // Unreachable through the client (its zod schema requires /^\d+$/ on
      // remainingAmount), kept as a silent belt-and-braces gate.
      continue;
    }
    const remainingAmount = BigInt(budget.remainingAmount);
    if (remainingAmount <= 0n) {
      // An exhausted budget cannot sign — the pair is not payable NOW,
      // which is exactly what listed ⇒ payable promises. Named after the
      // loop when no sibling covers the pair: a spent budget passes every
      // wallet-side checklist item, so without the warn it is a silent
      // zero-pairs state.
      budgetRowIssues.push({
        pairKey: `${caip2Network}:${asset}`,
        caip2Network,
        asset,
        evmWalletId,
        issue: "exhausted",
      });
      continue;
    }
    // Several budgets (wallets) can back one (network, asset) pair. Record
    // the one with the most remaining spend — the wallet most likely to
    // cover a demand at pay time — with the wallet id as a deterministic
    // tie-break so the recorded set is stable across syncs. Code-unit
    // comparison, not localeCompare: the recorded pair feeds the serialized
    // change-detection key, and locale/ICU differences between instances
    // must not flip which wallet wins.
    const key = `${caip2Network}:${asset}`;
    const current = readySources.get(key);
    if (
      !current ||
      remainingAmount > current.remainingAmount ||
      (remainingAmount === current.remainingAmount &&
        evmWalletId < current.pair.evmWalletId)
    ) {
      readySources.set(key, {
        pair: {
          caip2Network,
          asset,
          evmWalletId,
          evmWalletAddress,
          decimals: pricedAsset.decimals,
        },
        remainingAmount,
      });
    }
  }

  // Deferred to pair level: a failing row matters only if NO sibling budget
  // row backed its pair. The admin fallback below cannot rescue these pairs
  // (`configuredBudgetPairs` blocks it), so an unready pair here is final —
  // the pair-level claim in each warn is true by construction.
  for (const rowIssue of budgetRowIssues) {
    if (readySources.has(rowIssue.pairKey)) {
      continue;
    }
    const pairLabel = `${rowIssue.caip2Network}:${rowIssue.asset}`;
    if (rowIssue.issue === "unbindable") {
      console.warn(
        `[sync/agents] x402 budget for ${pairLabel} references Purchasing wallet ${rowIssue.evmWalletId}, which the node's listing does not usably expose (absent or retired, duplicate id, mismatched chain or address, or unfunded); no other budget backs the pair, so it cannot be buy-side ready and the configured budget also blocks the admin fallback — re-point or delete the budget, or fund its wallet`,
      );
    } else {
      console.warn(
        `[sync/agents] x402 budget for ${pairLabel} on Purchasing wallet ${rowIssue.evmWalletId} is spent to zero; no other budget backs the pair, so it cannot be buy-side ready and the exhausted budget also blocks the admin fallback — top up or delete the budget`,
      );
    }
  }

  // Reachable only with a key the node granted budgets access to (a plain
  // non-admin key fails the budgets check before compose runs — the node
  // admin-gates `GET /x402/budgets`). The trap this names: budgets are funded
  // on an enabled, priced chain, but the wallet listing yielded no usable
  // Purchasing wallet AT ALL — none created, only Selling-type wallets, or
  // (rare skew) a node that serves budgets while `api-key-status` withholds
  // `canAdmin`, emptying the client's listing. (A listed wallet with a
  // missing id cannot land here: the client's zod schema rejects the row and
  // the sync fails its check step instead.) The listed-but-unbindable and
  // exhausted cases get their own per-budget warns above. Without the names,
  // the operator debugs green node checks and an empty cache.
  if (configuredBudgetPairs.size > 0 && walletStatesById.size === 0) {
    console.warn(
      "[sync/agents] x402 budgets exist for enabled, priced chains but the node's wallet listing yielded no usable Purchasing wallet to verify them against (none created, only Selling-type wallets, or api-key-status withheld canAdmin), so NO budget can bind and no pair is buy-side ready — create and confirm exactly one funded Purchasing wallet per enabled chain",
    );
  }

  // Admins have unrestricted owner access in the payment node and may take
  // its uncapped path when no budget exists. The client returns wallets here
  // ONLY after a strict `canAdmin === true` status check — defence in depth
  // for version skew: a node that serves budgets while `api-key-status`
  // omits `canAdmin` must not enable this uncapped fallback by accident.
  // Require exactly one Purchasing wallet per chain: with several, Core has
  // no principled way to choose which balance should back payments, so
  // ambiguity fails closed.
  const adminWalletsByNetwork = new Map<
    string,
    AdminPurchasingWalletWithBalances[]
  >();
  for (const walletState of adminPurchasingWallets) {
    const { wallet } = walletState;
    const caip2Network = wallet.caip2Network?.toLowerCase();
    if (
      wallet.type !== "Purchasing" ||
      !wallet.id ||
      !caip2Network ||
      !enabledNetworks.get(caip2Network)
    ) {
      continue;
    }
    const wallets = adminWalletsByNetwork.get(caip2Network) ?? [];
    wallets.push(walletState);
    adminWalletsByNetwork.set(caip2Network, wallets);
  }
  for (const [caip2Network, pricedAsset] of enabledNetworks) {
    if (!pricedAsset) {
      continue;
    }
    const key = `${caip2Network}:${pricedAsset.asset}`;
    if (readySources.has(key)) {
      continue;
    }
    const wallets = adminWalletsByNetwork.get(caip2Network) ?? [];
    if (wallets.length !== 1) {
      continue;
    }
    const [{ wallet, balances }] = wallets;
    if (configuredBudgetPairs.has(key)) {
      continue;
    }
    const evmWalletId = trimEvmWalletId(wallet.id);
    if (!evmWalletId) {
      continue;
    }
    const evmWalletAddress = wallet.address.toLowerCase();
    if (
      !EVM_ADDRESS_PATTERN.test(evmWalletAddress) ||
      !hasRequiredWalletBalances(
        { wallet, balances },
        caip2Network,
        pricedAsset,
      )
    ) {
      continue;
    }
    readySources.set(key, {
      pair: {
        caip2Network,
        asset: pricedAsset.asset,
        evmWalletId,
        evmWalletAddress,
        decimals: pricedAsset.decimals,
      },
      remainingAmount: 0n,
    });
  }

  // At most one pair survives per allowed chain (only the node's default
  // asset is priceable), and each environment allows one chain today, so this
  // sort is a no-op right now. It stays because the allowlists are meant to
  // grow: the serialized array IS the change-detection key, so an order that
  // followed the node's budget order would flip the cache — and page — with
  // no readiness change behind it. Code-unit order, not localeCompare, for
  // the same reason: localeCompare depends on the host's ICU build and
  // default locale, so two Core instances could disagree on the order and
  // alternately rewrite the cache every cycle.
  //
  // NOTE: multi-pair output is untestable today — compose refuses every
  // chain outside the one-entry allowlist, so no input reaches this
  // comparator with two pairs. Whoever grows the allowlist must add
  // multi-pair compose/sort tests in the same change.
  return Array.from(readySources.values())
    .map(({ pair }) => pair)
    .sort((left, right) => {
      if (left.caip2Network !== right.caip2Network) {
        return left.caip2Network < right.caip2Network ? -1 : 1;
      }
      if (left.asset !== right.asset) {
        return left.asset < right.asset ? -1 : 1;
      }
      return 0;
    });
}
