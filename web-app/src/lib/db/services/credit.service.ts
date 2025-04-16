"use server";

import { z } from "zod";

import { getEnvPublicConfig } from "@/config/env.config";
import { AgentWithFixedPricing } from "@/lib/db/extension/agent";
import prisma from "@/lib/db/prisma";
import { AgentCreditsPrice } from "@/lib/db/types/credit.type";
import { convertCentsToCredits } from "@/lib/db/utils/credit.utils";
import { Prisma } from "@/prisma/generated/client";

export async function getCredits(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const creditsBalance = await getCents(userId, tx);
  return convertCentsToCredits(creditsBalance);
}

export async function getCents(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<bigint> {
  const creditsBalance = await tx.creditTransaction.aggregate({
    where: { userId },
    _sum: {
      amount: true,
    },
  });
  return creditsBalance._sum.amount ?? BigInt(0);
}

export async function validateCreditsBalance(
  userId: string,
  cents: bigint,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const centsBalance = await getCents(userId, tx);
  if (centsBalance - cents < BigInt(0)) {
    throw new Error("Insufficient balance");
  }
}

const amountsSchema = z.array(
  z.object({
    unit: z.string(),
    amount: z.number().positive(),
  }),
);

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
export async function calculateAgentCreditsPrice(
  agent: AgentWithFixedPricing,
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentCreditsPrice> {
  const amounts = agent.pricing?.fixedPricing?.amounts?.map((amount) => ({
    unit: amount.unit,
    amount: Number(amount.amount),
  }));
  if (!amounts) {
    return { cents: BigInt(0), includedFee: BigInt(0) };
  }
  return await calculateCreditsPrice(amounts, tx);
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
export async function calculateCreditsPrice(
  amounts: { unit: string; amount: number }[],
  tx: Prisma.TransactionClient = prisma,
): Promise<AgentCreditsPrice> {
  const feePercentagePoints = getEnvPublicConfig().NEXT_PUBLIC_FEE_PERCENTAGE;
  if (feePercentagePoints < 0) {
    throw new Error("Added fee percentage must be equal to or greater than 0");
  }
  const feeMultiplier = feePercentagePoints / 100;

  const amountsParsed = amountsSchema.parse(amounts);

  let totalCents = BigInt(0);
  let totalFee = BigInt(0);
  for (const amount of amountsParsed) {
    const creditCost = await tx.creditCost.findUnique({
      where: {
        unit: amount.unit == "lovelace" ? "" : amount.unit,
      },
    });
    if (!creditCost) {
      throw new Error(`Credit cost not found for unit ${amount.unit}`);
    }
    const cents = amount.amount * Number(creditCost.centsPerUnit);
    const fee = cents * feeMultiplier;

    // round up to the nearest integer
    totalCents += BigInt(Math.ceil(cents));
    totalFee += BigInt(Math.ceil(fee));
  }
  return { cents: totalCents + totalFee, includedFee: totalFee };
}
