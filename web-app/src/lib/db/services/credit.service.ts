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
export async function calculateAgentCreditCost(
  agent: AgentWithFixedPricing,
  feePercentagePoints: number | undefined = undefined,
) {
  const amounts = agent.pricing?.fixedPricing?.amounts?.map((amount) => ({
    unit: amount.unit,
    amount: Number(amount.amount),
  }));
  if (!amounts) {
    return 0;
  }
  if (feePercentagePoints === undefined) {
    feePercentagePoints = getEnvPublicConfig().DEFAULT_NETWORK_FEE_PERCENTAGE;
  }
  return Number(
    await calculateCreditCostAndValidateAmounts(amounts, feePercentagePoints),
  );
}

/**
 * Calculate the credit cost for a job
 * @param amounts - The amounts to calculate the credit cost for
 * @param feePercentagePoints - The fee percentage points to add (or subtract if negative) can not be less than -100 (=100% cost reduction), no upper limit (100=+100% cost increase, 0=no fee)
 * @returns The credit cost for the job
 */
export async function calculateCreditCostAndValidateAmounts(
  amounts: { unit: string; amount: number }[],
  feePercentagePoints: number | undefined = undefined,
) {
  if (feePercentagePoints === undefined) {
    feePercentagePoints = getEnvPublicConfig().DEFAULT_NETWORK_FEE_PERCENTAGE;
  }
  if (feePercentagePoints < -100) {
    throw new Error("Added fee percentage must be greater than 0");
  }
  const feeMultiplier = Math.max(1 + feePercentagePoints / 100, 0);

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
    const cost =
      Number(creditCost.creditCostPerUnit) * amount.amount * feeMultiplier;
    //round up to the nearest integer
    totalCreditCost += BigInt(Math.ceil(cost));
  }

  return totalCreditCost;
}
