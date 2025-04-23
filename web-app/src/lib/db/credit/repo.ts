"use server";

import { prisma } from "@/lib/db";
import { CreditTransaction, Prisma } from "@/prisma/generated/client";

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
