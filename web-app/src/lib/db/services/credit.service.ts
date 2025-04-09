"use server";

import { CreditTransaction, CreditTransactionType } from "@prisma/client";
import { z } from "zod";

import { getEnvPublicConfig } from "@/config/env.config";
import { AgentWithFixedPricing } from "@/lib/db/extension/agent";
import prisma from "@/lib/db/prisma";

/**
 * Retrieves the available balance of credits for a user.
 *
 * This function calculates the available balance by summing all successful credit transactions
 * and subtracting any pending transactions that have a negative amount (i.e., credits spent).
 *
 * @param userId - The ID of the user to retrieve the available balance for
 * @returns The available balance of credits for the user
 */
export async function getAvailableCredits(userId: string): Promise<number> {
  const creditBalance = await prisma.creditTransaction.aggregate({
    where: { userId },
    _sum: {
      amount: true,
    },
  });

  return await convertBaseUnitsToCredits(
    creditBalance._sum.amount ?? BigInt(0),
  );
}

/**
 * Retrieves a credit transaction by its ID.
 *
 * This function searches for a credit transaction in the database using the provided ID.
 * If a matching transaction is found, it is returned; otherwise, the function returns null.
 *
 * @param creditTransactionId - The ID of the credit transaction to retrieve
 * @returns A promise that resolves to the credit transaction object or null if not found
 */
export async function getCreditTransactionById(
  creditTransactionId: string,
): Promise<CreditTransaction | null> {
  return await prisma.creditTransaction.findUnique({
    where: { id: creditTransactionId },
  });
}

/**
 * Creates a pending credit transaction for topping up a user's account.
 *
 * This function creates a new credit transaction record with PENDING status
 * that will be updated to COMPLETED when the payment is confirmed via Stripe webhook.
 *
 * @param userId - The ID of the user adding credits to their account
 * @param credits - The number of credits to add (must be positive)
 * @returns The created credit transaction object
 * @throws Will throw an error if credits is less than or equal to 0
 */
export async function creditTransactionTopUp(
  userId: string,
  credits: number,
): Promise<CreditTransaction> {
  if (credits <= 0) {
    throw new Error("Credits must be greater than 0");
  }

  const newCreditTransaction = await prisma.creditTransaction.create({
    data: {
      userId,
      amount: await convertCreditsToBaseUnits(credits),
      type: CreditTransactionType.TOP_UP,
      includedFee: 0,
    },
  });

  return newCreditTransaction;
}

export async function creditTransactionSpend(
  userId: string,
  credits: bigint,
  includedFeeCredits: bigint,
  note: string | null = null,
  noteKey: string | null = null,
): Promise<CreditTransaction> {
  if (credits <= 0) {
    throw new Error("Credits must be greater than 0");
  }
  if (includedFeeCredits < 0) {
    throw new Error("Included fee credits must be greater than or equal to 0");
  }
  if (includedFeeCredits > credits) {
    throw new Error("Included fee credits must be less than total credits");
  }

  const availableBalance = await getAvailableCredits(userId);
  if (availableBalance < credits) {
    throw new Error("Insufficient balance");
  }

  return await prisma.creditTransaction.create({
    data: {
      userId,
      amount: -credits,
      includedFee: includedFeeCredits,
      type: CreditTransactionType.SPEND,
      note: note,
      noteKey: noteKey,
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

export async function convertBaseUnitsToCredits(
  credits: bigint,
): Promise<number> {
  return Number(credits) / 10 ** getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BASE;
}

export async function convertCreditsToBaseUnits(
  credits: number,
): Promise<bigint> {
  return BigInt(credits * 10 ** getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BASE);
}
