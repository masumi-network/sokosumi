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
  "network" | "payTo" | "pricingType"
> & {
  amounts: Pick<AgentPaymentSourceAmount, "unit" | "amount" | "decimals">[];
};

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
 * - the CAIP-2 network is in the per-environment allowlist,
 * - decimals are recorded (credits conversion is per whole token),
 * - the (network, asset) pair is buy-side ready on the payment node,
 * - the asset resolves to a positive CAIP-19 `CreditCost` row.
 */
export function buildX402AgentPaymentSources(
  paymentSources: readonly X402AgentPaymentSourceRow[],
  context: X402ListingGateContext,
): X402AgentPaymentSource[] | null {
  // No advertised source at all is "not payable now", not "free".
  if (paymentSources.length === 0) {
    return null;
  }

  const listed: X402AgentPaymentSource[] = [];
  for (const source of paymentSources) {
    if (source.pricingType !== PricingType.FIXED) {
      return null;
    }
    if (!source.payTo) {
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
      listed.push({
        caip2Network,
        asset: amount.unit.toLowerCase(),
        decimals: amount.decimals,
        payTo: source.payTo,
        amount: amount.amount.toString(),
        credits: convertCentsToCredits(cents),
      });
    }
  }

  return listed;
}
