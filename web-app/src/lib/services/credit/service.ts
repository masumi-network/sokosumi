import "server-only";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import {
  AgentWithFixedPricing,
  AgentWithRelations,
  convertCreditsToCents,
  CreditsPrice,
} from "@/lib/db";
import { creditCostRepository, prisma } from "@/lib/db/repositories";
import { pricingAmountsSchema, PricingAmountsSchemaType } from "@/lib/schemas";
import { Prisma } from "@/prisma/generated/client";

export interface AgentWithCreditPrice {
  agent: AgentWithRelations;
  creditsPrice: Awaited<ReturnType<typeof getAgentCreditsPrice>>;
}

/**
 * Calculates the total credit price (in cents) and included fee for a given agent's fixed pricing.
 *
 * This function extracts the pricing amounts from the agent's fixed pricing configuration,
 * converts them to the expected format, and delegates the calculation to `calculateCreditsPrice`.
 * If the agent does not have fixed pricing amounts, it returns zero for both cents and included fee.
 *
 * @param agent - The agent object containing fixed pricing information.
 * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
 * @returns An object containing the total price in cents and the included fee, both as bigint.
 */
export async function getAgentCreditsPrice(
  agent: AgentWithFixedPricing,
  tx: Prisma.TransactionClient = prisma,
): Promise<CreditsPrice> {
  const amounts = agent.pricing?.fixedPricing?.amounts?.map((amount) => ({
    unit: amount.unit,
    amount: Number(amount.amount),
  }));
  if (!amounts) {
    return { cents: BigInt(0), includedFee: BigInt(0) };
  }
  return await getCreditsPrice(amounts, tx);
}

/**
 * Calculates the total price in cents and the included fee for a set of credit amounts.
 *
 * For each amount, this function:
 * - Looks up the credit cost per unit in the database (using the provided transaction client).
 * - Multiplies the amount by the cost per unit to get the subtotal in cents.
 * - Applies a fee percentage (from environment config) to the subtotal.
 * - Rounds up both subtotal and fee to the nearest integer.
 * - Sums all subtotals and fees across all amounts.
 *
 * If a unit is "lovelace", it is mapped to an empty string for lookup.
 * Throws an error if a credit cost for a unit is not found, or if the fee percentage is negative.
 *
 * @param amounts - Array of objects with `unit` (string) and `amount` (positive number).
 * @param tx - (Optional) Prisma transaction client for DB operations. Defaults to the main Prisma client.
 * @returns An object with `cents` (total price including fee, as bigint) and `includedFee` (total fee, as bigint).
 * @throws Error if a credit cost for a unit is not found or if the fee percentage is negative.
 */
export async function getCreditsPrice(
  amounts: PricingAmountsSchemaType,
  tx: Prisma.TransactionClient = prisma,
): Promise<CreditsPrice> {
  const feePercentagePoints = getEnvPublicConfig().NEXT_PUBLIC_FEE_PERCENTAGE;
  if (feePercentagePoints < 0) {
    throw new Error("Added fee percentage must be equal to or greater than 0");
  }
  const feeMultiplier = feePercentagePoints / 100;
  const amountsParsed = pricingAmountsSchema.parse(amounts);

  let totalCents = BigInt(0);
  let totalFee = BigInt(0);
  const minFeeCents = convertCreditsToCents(getEnvSecrets().MIN_FEE_CREDITS);
  for (const amount of amountsParsed) {
    const creditCost = await creditCostRepository.getCreditCostByUnit(
      amount.unit,
      tx,
    );
    if (!creditCost) {
      throw new Error(`Credit cost not found for unit ${amount.unit}`);
    }
    const cents = amount.amount * Number(creditCost.centsPerUnit);
    const fee = cents * feeMultiplier;

    // round up to the nearest integer
    totalCents += BigInt(Math.ceil(cents));
    totalFee += BigInt(Math.ceil(fee));
  }
  if (totalFee < minFeeCents) {
    totalFee = minFeeCents;
  }
  return { cents: totalCents + totalFee, includedFee: totalFee };
}
