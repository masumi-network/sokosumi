"use server";

import { z } from "zod";

import { getEnvPublicConfig } from "@/config/env.config";
import { AgentWithFixedPricing } from "@/lib/db/extension/agent";
import prisma from "@/lib/db/prisma";
import { AgentCreditsPrice } from "@/lib/db/types/credit.type";
import { Prisma } from "@/prisma/generated/client";

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
 * Calculates Agent's credit costs (in base units) and included fee.
 * @param agent - The agent with fixed pricing information
 * @returns The total credit cost for the agent in base units, or 0 if no pricing amounts are available
 * @throws Error if credit cost for a unit is not found or if fee percentage is negative
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
 * Calculate the credit cost for a job
 * @param amounts - The amounts to calculate the credit cost for
 * @returns The credit cost for the job in base units
 * @throws Error if credit cost for a unit is not found or if fee percentage is negative
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
