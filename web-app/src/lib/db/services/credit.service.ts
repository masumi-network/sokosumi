import { CreditTransaction } from "@prisma/client";
import { z } from "zod";

import { getEnvPublicConfig } from "@/config/env.config";
import { AgentWithFixedPricing } from "@/lib/db/extension/agent";
import prisma from "@/lib/db/prisma";
import { convertBaseUnitsToCredits } from "@/lib/db/utils/credit.utils";

export async function getCreditBalance(userId: string): Promise<bigint> {
  const creditBalance = await prisma.creditTransaction.aggregate({
    where: { userId },
    _sum: {
      amount: true,
    },
  });

  return creditBalance._sum.amount ?? BigInt(0);
}

export async function createCreditTransaction(
  userId: string,
  credits: bigint,
): Promise<CreditTransaction> {
  // if credits is positive, it is a top up
  if (credits > 0) {
    const availableBalance = await getCreditBalance(userId);
    if (availableBalance < credits) {
      throw new Error("Insufficient balance");
    }
  }

  return await prisma.creditTransaction.create({
    data: {
      userId,
      amount: credits,
    },
  });
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
): Promise<number> {
  const amounts = agent.pricing?.fixedPricing?.amounts?.map((amount) => ({
    unit: amount.unit,
    amount: Number(amount.amount),
  }));
  if (!amounts) {
    return 0.0;
  }
  const creditCost = await calculateCreditCost(amounts);
  return convertBaseUnitsToCredits(creditCost);
}

/**
 * Calculate the credit cost for a job
 * @param amounts - The amounts to calculate the credit cost for
 * @returns The credit cost for the job in base units
 * @throws Error if credit cost for a unit is not found or if fee percentage is negative
 */
export async function calculateCreditCost(
  amounts: { unit: string; amount: number }[],
): Promise<bigint> {
  const feePercentagePoints = getEnvPublicConfig().NEXT_PUBLIC_FEE_PERCENTAGE;
  if (feePercentagePoints < 0) {
    throw new Error("Added fee percentage must be equal to or greater than 0");
  }
  const feeMultiplier = feePercentagePoints / 100;

  const amountsParsed = amountsSchema.parse(amounts);

  let totalCreditCost = BigInt(0);
  for (const amount of amountsParsed) {
    const creditCost = await prisma.creditCost.findUnique({
      where: {
        unit: amount.unit == "lovelace" ? "" : amount.unit,
      },
    });
    if (!creditCost) {
      throw new Error(`Credit cost not found for unit ${amount.unit}`);
    }
    const cost = amount.amount * Number(creditCost.creditCostPerUnit);
    const fee = cost * feeMultiplier;
    const totalCost = cost + fee;

    // round up to the nearest integer
    totalCreditCost += BigInt(Math.ceil(totalCost));
  }
  return totalCreditCost;
}
