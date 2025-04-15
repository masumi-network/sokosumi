"use server";

import { z } from "zod";

import { getEnvPublicConfig } from "@/config/env.config";
import { AgentWithFixedPricing } from "@/lib/db/extension/agent";
import prisma from "@/lib/db/prisma";
import { convertBaseUnitsToCredits } from "@/lib/db/utils/credit.utils";
import { Prisma } from "@/prisma/generated/client";

export async function getCreditBalance(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<bigint> {
  const creditBalance = await tx.creditTransaction.aggregate({
    where: { userId },
    _sum: {
      amount: true,
    },
  });
  return creditBalance._sum.amount ?? BigInt(0);
}

export async function validateCreditBalance(
  userId: string,
  credits: bigint,
  tx: Prisma.TransactionClient = prisma,
): Promise<void> {
  const creditBalance = await getCreditBalance(userId, tx);
  if (creditBalance - credits < BigInt(0)) {
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
 * Calculates the human readable credit cost for an agent with fixed pricing
 * @param agent - The agent with fixed pricing information
 * @returns The total credit cost for the agent in number format, or 0 if no pricing amounts are available
 * @throws Error if credit cost for a unit is not found or if fee percentage is negative
 */
export async function calculateAgentHumandReadableCreditCost(
  agent: AgentWithFixedPricing,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const amounts = agent.pricing?.fixedPricing?.amounts?.map((amount) => ({
    unit: amount.unit,
    amount: Number(amount.amount),
  }));
  if (!amounts) {
    return 0.0;
  }
  const cost = await calculateCreditCost(amounts, tx);
  return convertBaseUnitsToCredits(cost.credits);
}

/**
 * Calculate the credit cost for a job
 * @param amounts - The amounts to calculate the credit cost for
 * @returns The credit cost for the job in base units
 * @throws Error if credit cost for a unit is not found or if fee percentage is negative
 */
export async function calculateCreditCost(
  amounts: { unit: string; amount: number }[],
  tx: Prisma.TransactionClient = prisma,
): Promise<{ credits: bigint; includedFee: bigint }> {
  const feePercentagePoints = getEnvPublicConfig().NEXT_PUBLIC_FEE_PERCENTAGE;
  if (feePercentagePoints < 0) {
    throw new Error("Added fee percentage must be equal to or greater than 0");
  }
  const feeMultiplier = feePercentagePoints / 100;

  const amountsParsed = amountsSchema.parse(amounts);

  let totalCost = BigInt(0);
  let totalFee = BigInt(0);
  // Calculate the total credit cost and fee for each amount
  for (const amount of amountsParsed) {
    const creditCost = await tx.creditCost.findUnique({
      where: {
        unit: amount.unit == "lovelace" ? "" : amount.unit,
      },
    });
    if (!creditCost) {
      throw new Error(`Credit cost not found for unit ${amount.unit}`);
    }
    const cost = amount.amount * Number(creditCost.creditCostPerUnit);
    const fee = cost * feeMultiplier;

    // round up to the nearest integer
    totalCost += BigInt(Math.ceil(cost));
    totalFee += BigInt(Math.ceil(fee));
  }
  return { credits: totalCost + totalFee, includedFee: totalFee };
}
