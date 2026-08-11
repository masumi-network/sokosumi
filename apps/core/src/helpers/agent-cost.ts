import {
  type AgentWithPricing,
  type CreditCost,
  PricingType,
} from "@sokosumi/database";
import { isCaip19AssetKey, normalizeMasumiPaymentUnit } from "@sokosumi/masumi";

import { unprocessableEntity } from "./error";

/**
 * Cardano-convention agent pricing → billable cents.
 *
 * Everything in this file prices per SMALLEST unit (`centsPerUnit` × amount
 * in lovelace/asset base units). CAIP-19 `CreditCost` rows
 * (`eip155:<chainId>/erc20:0x…`) follow the OTHER convention — cents per WHOLE token
 * (see `calculateCentsFromX402Amount` in `x402-pricing.ts`) — so a CAIP-19
 * unit reaching these readers would be charged 10^decimals× wrong. Each
 * entry point fences that out explicitly.
 */

export interface AgentCost {
  cents: bigint;
}

/**
 * Gets an agent's cost.
 * @param agent - The agent with pricing.
 * @param creditCosts - The credit costs.
 * @returns The cost for the agent.
 */
export const getAgentCost = (
  agent: AgentWithPricing,
  creditCosts: CreditCost[],
): AgentCost => {
  return calculateAgentCost(agent, creditCosts);
};

/**
 * The `CreditCost.unit` spellings the Cardano pricing path may bill against,
 * for `buildAvailableAgentWhereClause`'s `validUnits` match.
 *
 * Both spellings of every unit, because the two sides of the comparison were
 * written in different eras: ingestion stores
 * `normalizeMasumiPaymentUnit(...)` — lowercased — but `CreditCost.unit` is
 * free-form operator input, and rows ingested before that change kept the
 * registry's original casing. Prisma `in` is a case-sensitive `= ANY(...)`,
 * so matching one spelling alone silently drops agents in SQL.
 *
 * CAIP-19 units are EXCLUDED: they price per whole token, not per smallest
 * unit like every row this Cardano-convention path reads, so a registry
 * pricing row spelling a CAIP-19 key must never make an agent billable here
 * (it would charge 10^decimals× wrong — see the module doc).
 */
export function listCardanoBillableUnitSpellings(
  creditCosts: CreditCost[],
): string[] {
  return Array.from(
    new Set(
      creditCosts
        .filter(
          (creditCost) =>
            !isCaip19AssetKey(normalizeMasumiPaymentUnit(creditCost.unit)),
        )
        .flatMap((creditCost) =>
          normalizeMasumiPaymentUnit(creditCost.unit) === "lovelace"
            ? [creditCost.unit, "lovelace", ""]
            : [creditCost.unit, normalizeMasumiPaymentUnit(creditCost.unit)],
        ),
    ),
  );
}

/**
 * Converts on-chain pricing rows (unit + amount in smallest units) to billable cents
 * using the CreditCost table. Used for fixed agent pricing and task masumi payments.
 */
function calculateCentsFromPricingAmountRows(
  rows: readonly { unit: string; amount: bigint }[],
  creditCosts: CreditCost[],
): bigint {
  let totalCents = BigInt(0);
  for (const row of rows) {
    const unit = normalizeMasumiPaymentUnit(row.unit);
    if (isCaip19AssetKey(unit)) {
      // Wrong convention path: CAIP-19 rows price per WHOLE token, this
      // reader multiplies per SMALLEST unit — honoring the row would charge
      // 10^decimals× wrong. x402 amounts go through
      // calculateCentsFromX402Amount instead.
      throw unprocessableEntity(
        `Unit ${unit} is a CAIP-19 asset key and cannot be priced per smallest unit`,
      );
    }
    const creditCost = creditCosts.find(
      (candidate) => normalizeMasumiPaymentUnit(candidate.unit) === unit,
    );
    if (!creditCost) {
      throw unprocessableEntity(`Credit cost not found for unit ${unit}`);
    }
    totalCents += row.amount * creditCost.centsPerUnit;
  }
  return totalCents;
}

/**
 * Parses Masumi payment Amounts (string amounts) and returns billable cents.
 */
export function calculateCentsFromMasumiAmountStrings(
  amounts: readonly { amount: string; unit: string }[],
  creditCosts: CreditCost[],
): bigint {
  if (amounts.length === 0) {
    throw unprocessableEntity("Amounts must not be empty");
  }

  const rows: { unit: string; amount: bigint }[] = [];
  for (const entry of amounts) {
    let amount: bigint;
    try {
      amount = BigInt(entry.amount);
    } catch {
      throw unprocessableEntity(`Invalid amount: ${entry.amount}`);
    }
    if (amount <= 0n) {
      throw unprocessableEntity("Amount must be positive");
    }
    const unit = normalizeMasumiPaymentUnit(entry.unit);
    // Deliberately AFTER normalization: an empty unit is Masumi's spelling of
    // ADA and becomes "lovelace", so only a whitespace-only unit — which
    // normalizes to itself and names no asset — is rejected here.
    if (unit.trim().length === 0) {
      throw unprocessableEntity("Unit must not be empty");
    }
    rows.push({ unit, amount });
  }

  return calculateCentsFromPricingAmountRows(rows, creditCosts);
}

/**
 * Calculates the cost for an agent from its pricing configuration.
 * @param agent - The agent with pricing.
 * @param creditCosts - The credit costs.
 * @returns The cost for the agent.
 */
const calculateAgentCost = (
  agent: AgentWithPricing,
  creditCosts: CreditCost[],
): AgentCost => {
  switch (agent.pricing.pricingType) {
    case PricingType.FIXED: {
      if (
        !agent.pricing.fixedPricing ||
        agent.pricing.fixedPricing.amounts.length === 0
      ) {
        throw unprocessableEntity("Agent has invalid or unknown pricing");
      }
      const pricing = agent.pricing.fixedPricing.amounts.map((amount) => ({
        unit: amount.unit,
        amount: amount.amount,
      }));

      return {
        cents: calculateCentsFromPricingAmountRows(pricing, creditCosts),
      };
    }
    case PricingType.FREE: {
      return { cents: BigInt(0) };
    }
    case PricingType.UNKNOWN: {
      throw unprocessableEntity("Agent has invalid or unknown pricing");
    }
  }
};
