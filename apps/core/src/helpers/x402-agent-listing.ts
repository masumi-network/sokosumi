import type {
  AgentPaymentSource,
  AgentPaymentSourceAmount,
  CreditCost,
} from "@sokosumi/database";
import { PricingType } from "@sokosumi/database";
import { EVM_ADDRESS_PATTERN } from "@sokosumi/masumi";
import { convertCentsToCredits } from "@sokosumi/utils";

import type { X402AgentPaymentSource } from "@/schemas/x402-agent.schema";

import { calculateCentsFromX402Amount } from "./x402-pricing";
import type { X402ReadySource } from "./x402-readiness";
import { isX402NetworkAllowed, isX402SourceReady } from "./x402-readiness";

export interface X402ListingGateContext {
  /** CreditCost table rows; CAIP-19 keyed rows price the x402 assets. */
  creditCosts: CreditCost[];
  /** Buy-side ready (network, asset) pairs from getX402ReadySources. */
  readySources: readonly X402ReadySource[];
  /** Deployment environment, gates the per-env CAIP-2 network allowlist. */
  network: "Preprod" | "Mainnet";
}

export type X402AgentPaymentSourceRow = Pick<
  AgentPaymentSource,
  "network" | "payTo" | "pricingType" | "scheme"
> & {
  amounts: Pick<AgentPaymentSourceAmount, "unit" | "amount" | "decimals">[];
};

/**
 * The only x402 payment scheme Sokosumi can pay. `scheme` is the field that
 * decides WHAT the payer signs, and the registry mirrors it verbatim into a
 * nullable column (`AgentPaymentSource.scheme`) — a Bazaar entry writes
 * `"exact"`, a Cardano or pre-x402 entry writes null. Anything else is a
 * signing contract this build does not implement, so it must not be listed as
 * payable; matched case-insensitively because the value is registry text.
 *
 * The sibling registry columns `chain` and `paymentSourceType` are
 * deliberately NOT gated: both are free-form registry text with no fixed
 * vocabulary for EVM rails (a Bazaar entry writes `chain: "Base"` and a null
 * `paymentSourceType`), so any predicate over them would be a guess. The
 * chain a payment settles on is pinned by the CAIP-2 `network` allowlist,
 * which is authoritative and checked below.
 */
const X402_SUPPORTED_SCHEME = "exact";

/**
 * Why an agent was not advertised. Carried out of the gate loop so the route
 * can report WHICH gate emptied a listing — "nothing registered", "nothing
 * priced", and "everything failed the network gate" are indistinguishable
 * from an empty array alone.
 */
export type X402ListingDropReason =
  /** The agent registered no payment source at all. */
  | "no_payment_source"
  /** A source is FREE/DYNAMIC/UNKNOWN priced — no price to verify against. */
  | "pricing_not_fixed"
  /** A source records no `payTo` recipient. */
  | "missing_pay_to"
  /** A source's `payTo` is not a well-formed EVM address. */
  | "malformed_pay_to"
  /** A source advertises a scheme other than x402 `exact`. */
  | "unsupported_scheme"
  /** A source's CAIP-2 network is outside this environment's allowlist. */
  | "network_not_allowed"
  /** A FIXED source's amount rows are missing. */
  | "no_amount_rows"
  /** An amount row has no recorded decimals. */
  | "missing_decimals"
  /** The (network, asset) pair is not buy-side ready on the payment node. */
  | "not_buy_side_ready"
  /** The asset has no positive CAIP-19 `CreditCost` row. */
  | "unpriced_asset"
  /** One (payTo, network, asset) triple is advertised at two prices. */
  | "conflicting_price";

export type X402AgentListingResult =
  | { status: "listed"; paymentSources: X402AgentPaymentSource[] }
  | { status: "dropped"; reason: X402ListingDropReason };

/**
 * Maps an x402 agent's registered payment sources to the listing response, or
 * reports why the agent must be dropped (PR1-SPEC §2, fail closed).
 *
 * Listed ⇒ payable is a per-AGENT promise: EVERY advertised source must pass
 * every gate, because the agent — not Soko — picks which source its 402
 * demands. A single unpayable source means a 402 the pay endpoint would have
 * to reject after the coworker already did the work of calling the agent, so
 * the agent is hidden instead:
 *
 * - the source advertises a fixed price (`FIXED` with at least one amount —
 *   Free/Dynamic/unknown pricing has no chargeable price to verify against),
 * - `payTo` is present and a well-formed EVM address (the pay endpoint
 *   verifies the 402's payTo against it),
 * - the scheme is x402 `exact` (see {@link X402_SUPPORTED_SCHEME}),
 * - the CAIP-2 network is in the per-environment allowlist,
 * - decimals are recorded (credits conversion is per whole token),
 * - the (network, asset) pair is buy-side ready on the payment node,
 * - the asset resolves to a positive CAIP-19 `CreditCost` row,
 * - no two amount rows advertise the same `(payTo, network, asset)` triple at
 *   different prices (see {@link toAdvertisedPriceKey}).
 */
export function buildX402AgentPaymentSources(
  paymentSources: readonly X402AgentPaymentSourceRow[],
  context: X402ListingGateContext,
): X402AgentListingResult {
  // No advertised source at all is "not payable now", not "free".
  if (paymentSources.length === 0) {
    return { status: "dropped", reason: "no_payment_source" };
  }

  // Advertised entries keyed by (payTo, network, asset) — the triple the pay
  // endpoint resolves a 402's demand against. Deduped agent-wide, not per
  // source: the pay side scans sources in order and stops at the first with a
  // matching asset, so a second source repeating the triple is the same
  // ambiguity as a repeat inside one source.
  const advertisedByTriple = new Map<string, X402AgentPaymentSource>();
  const listed: X402AgentPaymentSource[] = [];
  for (const source of paymentSources) {
    if (source.pricingType !== PricingType.FIXED) {
      return { status: "dropped", reason: "pricing_not_fixed" };
    }
    const payTo = source.payTo?.trim() ?? "";
    if (!payTo) {
      return { status: "dropped", reason: "missing_pay_to" };
    }
    // The pay endpoint's `payTo` comes out of an EVM_ADDRESS_PATTERN-validated
    // 402, so a recipient that is not an EVM address can never be matched:
    // listing it advertises a demand the pay endpoint is guaranteed to reject
    // after the coworker already called the agent. The asset gets this check
    // implicitly through `buildCaip19AssetKey`; `payTo` has no such consumer,
    // so it is checked here. Mixed case is accepted — the registry serves
    // checksummed addresses and only the dedupe key case-folds.
    if (!EVM_ADDRESS_PATTERN.test(payTo)) {
      return { status: "dropped", reason: "malformed_pay_to" };
    }
    if (source.scheme?.trim().toLowerCase() !== X402_SUPPORTED_SCHEME) {
      return { status: "dropped", reason: "unsupported_scheme" };
    }
    if (!isX402NetworkAllowed(source.network, context.network)) {
      return { status: "dropped", reason: "network_not_allowed" };
    }
    // A FIXED source whose amount rows are momentarily gone (registry replay
    // deletes and recreates them) has no advertised price to verify against.
    if (source.amounts.length === 0) {
      return { status: "dropped", reason: "no_amount_rows" };
    }
    const caip2Network = source.network.trim().toLowerCase();
    for (const amount of source.amounts) {
      if (amount.decimals === null) {
        return { status: "dropped", reason: "missing_decimals" };
      }
      if (!isX402SourceReady(caip2Network, amount.unit, context.readySources)) {
        return { status: "dropped", reason: "not_buy_side_ready" };
      }
      let cents: bigint;
      try {
        cents = calculateCentsFromX402Amount(
          {
            caip2Network,
            asset: amount.unit,
            amount: amount.amount.toString(),
            decimals: amount.decimals,
          },
          context.creditCosts,
        );
      } catch {
        // Unpriced asset, malformed identity, or non-positive CreditCost row —
        // the exact set of pre-charge rejections the pay endpoint enforces.
        return { status: "dropped", reason: "unpriced_asset" };
      }
      const advertised: X402AgentPaymentSource = {
        caip2Network,
        // Canonicalized HERE, once, so the advertised value and the dedupe key
        // below are the same string. Ingestion keeps whatever the registry
        // wrote (`normalizeMasumiPaymentUnit` lowercases but never trims),
        // while every consumer — `findX402ReadySource`, `buildCaip19AssetKey`,
        // and the pay side's 402 matcher — compares trimmed lowercase. A
        // padded spelling left here would pass every gate, dedupe as a second
        // asset, and then match no 402 demand.
        asset: amount.unit.trim().toLowerCase(),
        decimals: amount.decimals,
        payTo,
        amount: amount.amount.toString(),
        credits: convertCentsToCredits(cents),
      };
      const tripleKey = toAdvertisedPriceKey(advertised);
      const alreadyAdvertised = advertisedByTriple.get(tripleKey);
      if (alreadyAdvertised) {
        if (
          alreadyAdvertised.amount !== advertised.amount ||
          alreadyAdvertised.decimals !== advertised.decimals
        ) {
          // Two prices for one triple. The pay endpoint resolves the triple to
          // exactly ONE amount row and rejects a demand above it, so which
          // price is real depends on unordered row identity — listed would
          // stop implying payable. Fail closed on the whole agent.
          return { status: "dropped", reason: "conflicting_price" };
        }
        // Ingestion permits duplicate units within one source's fixed amounts
        // (agent-sync.projection zips decimals positionally). Rows that agree
        // are one advertised price, not two.
        continue;
      }
      advertisedByTriple.set(tripleKey, advertised);
      listed.push(advertised);
    }
  }

  // Unreachable via the gates above (a source with no amount rows already
  // dropped), but the response schema requires at least one advertised source,
  // so an empty list is a drop rather than a 500 on the way out.
  if (listed.length === 0) {
    return { status: "dropped", reason: "no_amount_rows" };
  }
  return { status: "listed", paymentSources: listed };
}

/**
 * Identity of an advertised price: the `(payTo, network, asset)` triple a 402
 * demand is matched on. All three fields arrive canonical (trimmed, and
 * lowercase for network and asset), so the key only case-folds `payTo` — the
 * one field advertised in its registry spelling, because the registry serves
 * mixed-case checksummed EVM addresses and the pay side compares them
 * case-insensitively. Two spellings of one recipient are one recipient here.
 *
 * Canonicalizing at the assignment above rather than in this key is what keeps
 * the gates and the dedupe in agreement: a key that normalized more than the
 * advertised value would hide a padded asset that no 402 can ever match, and a
 * key that normalized less would let one triple be advertised twice.
 */
function toAdvertisedPriceKey(advertised: X402AgentPaymentSource): string {
  return [
    advertised.payTo.toLowerCase(),
    advertised.caip2Network,
    advertised.asset,
  ].join("|");
}
