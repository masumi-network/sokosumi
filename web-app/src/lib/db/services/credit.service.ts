import { CreditTransactionStatus, CreditTransactionType } from "@prisma/client";
import { z } from "zod";

import { getEnvPublicConfig } from "@/config/env.config";
import { AgentWithFixedPricing } from "@/lib/db/extension/agent";
import prisma from "@/lib/db/prisma";

export async function getCreditBalance(userId: string): Promise<number> {
  const creditBalance = await prisma.creditTransaction.aggregate({
    where: { userId },
    _sum: {
      amount: true,
    },
  });

  return Number(creditBalance._sum.amount ?? 0);
}

export async function creditTransactionSpend(
  userId: string,
  credits: bigint,
  includedFeeCredits: bigint,
  note: string | null = null,
  noteKey: string | null = null,
) {
  if (credits <= 0) {
    throw new Error("Credits must be greater than 0");
  }
  if (includedFeeCredits < 0) {
    throw new Error("Included fee credits must be greater than or equal to 0");
  }
  if (includedFeeCredits > credits) {
    throw new Error("Included fee credits must be less than total credits");
  }

  const newCreditTransaction = await prisma.$transaction(async (tx) => {
    const creditBalance = await tx.creditTransaction.aggregate({
      where: { userId },
      _sum: {
        amount: true,
      },
    });

    if (
      creditBalance._sum.amount === null ||
      creditBalance._sum.amount < credits
    ) {
      throw new Error("Insufficient balance");
    }

    return await tx.creditTransaction.create({
      data: {
        userId,
        amount: -credits,
        includedFee: includedFeeCredits,
        type: CreditTransactionType.SPEND,
        status: CreditTransactionStatus.PENDING,
        note: note,
        noteKey: noteKey,
      },
    });
  });
  return newCreditTransaction;
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
  return formatCreditsForDisplay(creditCost);
}

/**
 * Calculate the credit cost for a job
 * @param amounts - The amounts to calculate the credit cost for
 * @returns The credit cost for the job
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

export function formatCreditsForDisplay(credits: bigint): number {
  return Number(credits) / 10 ** getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BASE;
}

export function convertCreditsToBaseUnits(credits: number): bigint {
  return BigInt(credits * 10 ** getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BASE);
}
