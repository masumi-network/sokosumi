"use server";

import { prisma } from "@/lib/db";
import {
  CreditTransaction,
  FiatService,
  FiatTransactionStatus,
  Prisma,
} from "@/prisma/generated/client";

/**
 * Retrieves the total credit balance (in cents) for a given user.
 *
 * This function aggregates all credit transactions for the specified user and sums the 'amount' field.
 * If the user has no credit transactions, it returns 0n (bigint zero).
 *
 * @param userId - The ID of the user whose credit balance is being retrieved.
 * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
 * @returns The total credit balance in cents as a bigint.
 */
export async function getCentsByUserId(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<bigint> {
  const centsBalance = await tx.creditTransaction.aggregate({
    where: { userId },
    _sum: {
      amount: true,
    },
  });
  return centsBalance._sum.amount ?? BigInt(0);
}

export async function getCreditTransactionByJobId(
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<CreditTransaction | null> {
  return tx.creditTransaction.findFirst({
    where: { job: { id: jobId } },
    include: {
      job: true,
    },
  });
}

export async function createCreditTransaction(
  userId: string,
  cents: bigint,
  tx: Prisma.TransactionClient = prisma,
): Promise<CreditTransaction> {
  return tx.creditTransaction.create({
    data: {
      amount: cents,
      user: {
        connect: {
          id: userId,
        },
      },
    },
  });
}

/**
 * Checks if a user has claimed free credits.
 *
 * This function checks if the user has succeeded a free credits transaction by querying the database.
 * If the user has succeeded a free credits transaction, it returns true. Otherwise, it returns false.
 *
 * @param userId - The ID of the user whose free credits claim status is being checked.
 * @param tx - (Optional) The Prisma transaction client to use for database operations. Defaults to the main Prisma client.
 * @returns True if the user has claimed free credits, false otherwise.
 */
export async function hasFreeCreditsTransaction(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const exists = await tx.fiatTransaction.findFirst({
    where: {
      userId,
      amount: 0,
      service: FiatService.STRIPE,
      status: FiatTransactionStatus.SUCCEEDED,
      NOT: {
        creditTransaction: {
          is: null,
        },
      },
    },
  });
  return exists !== null;
}
