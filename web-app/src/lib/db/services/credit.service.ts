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
  amount: bigint,
  includedFee: bigint,
  note: string | null = null,
  noteKey: string | null = null,
) {
  if (amount <= 0) {
    throw new Error("Amount must be greater than 0");
  }
  if (includedFee < 0) {
    throw new Error("Included fee must be greater than 0");
  }
  if (includedFee > amount) {
    throw new Error("Included fee must be less than amount");
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
      creditBalance._sum.amount < amount
    ) {
      throw new Error("Insufficient balance");
    }

    return await tx.creditTransaction.create({
      data: {
        userId,
        amount: -amount,
        includedFee: includedFee,
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
 * Calculates the credit cost for an agent with fixed pricing
 * @param agent - The agent with fixed pricing information
 * @returns The total credit cost for the agent in number format, or 0 if no pricing amounts are available
 * @throws Error if credit cost for a unit is not found or if fee percentage is negative
 */
export async function calculateAgentCreditCost(agent: AgentWithFixedPricing) {
  const amounts = agent.pricing?.fixedPricing?.amounts?.map((amount) => ({
    unit: amount.unit,
    amount: Number(amount.amount),
  }));
  if (!amounts) {
    return 0;
  }
  return Number(await calculateCreditCost(amounts));
}

/**
 * Calculate the credit cost for a job
 * @param amounts - The amounts to calculate the credit cost for
 * @returns The credit cost for the job
 * @throws Error if credit cost for a unit is not found or if fee percentage is negative
 */
export async function calculateCreditCost(
  amounts: { unit: string; amount: number }[],
) {
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
    const cost = Number(creditCost.creditCostPerUnit) * amount.amount;
    const fee = cost * feeMultiplier;
    const totalCost = cost + fee;

    // round up to the nearest integer
    totalCreditCost += BigInt(Math.ceil(totalCost));
  }

  return totalCreditCost;
}

export function getCreditsToDisplay(credits: number): number {
  return credits / 10 ** getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BASE;
}
