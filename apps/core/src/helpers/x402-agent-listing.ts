import type {
  AgentPaymentSource,
  AgentPaymentSourceAmount,
  CreditCost,
} from "@sokosumi/database";
import { PricingType } from "@sokosumi/database";
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
 * Maps an x402 agent's registered payment sources to the listing response, or
 * returns `null` when the agent must be dropped (PR1-SPEC §2, fail closed).
 *
 * Listed ⇒ payable is a per-AGENT promise: EVERY advertised source must pass
 * every gate, because the agent — not Soko — picks which source its 402
 * demands. A single unpayable source means a 402 the pay endpoint would have
 * to reject after the coworker already did the work of calling the agent, so
 * the agent is hidden instead:
 *
 * - the source advertises a fixed price (`FIXED` with at least one amount —
 *   Free/Dynamic/unknown pricing has no chargeable price to verify against),
 * - `payTo` is present (the pay endpoint verifies the 402's payTo against it),
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
): X402AgentPaymentSource[] | null {
  // No advertised source at all is "not payable now", not "free".
  if (paymentSources.length === 0) {
    return null;
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
      return null;
    }
    if (!source.payTo) {
      return null;
    }
    if (source.scheme?.trim().toLowerCase() !== X402_SUPPORTED_SCHEME) {
      return null;
    }
    if (!isX402NetworkAllowed(source.network, context.network)) {
      return null;
    }
    // A FIXED source whose amount rows are momentarily gone (registry replay
    // deletes and recreates them) has no advertised price to verify against.
    if (source.amounts.length === 0) {
      return null;
    }
    const caip2Network = source.network.trim().toLowerCase();
    for (const amount of source.amounts) {
      if (amount.decimals === null) {
        return null;
      }
      if (!isX402SourceReady(caip2Network, amount.unit, context.readySources)) {
        return null;
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
        return null;
      }
      const advertised: X402AgentPaymentSource = {
        caip2Network,
        asset: amount.unit.toLowerCase(),
        decimals: amount.decimals,
        payTo: source.payTo,
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
          return null;
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

  return listed;
}

/**
 * Identity of an advertised price: the `(payTo, network, asset)` triple a 402
 * demand is matched on. Case-folded — the registry serves mixed-case EVM
 * addresses and the pay side compares them case-insensitively, so two
 * spellings of one recipient are one recipient here too.
 */
function toAdvertisedPriceKey(advertised: X402AgentPaymentSource): string {
  return [
    advertised.payTo.trim().toLowerCase(),
    advertised.caip2Network,
    advertised.asset,
  ].join("|");
}
