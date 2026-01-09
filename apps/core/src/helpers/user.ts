import type { Prisma } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";
import { convertCentsToCredits } from "@sokosumi/database/helpers";

/**
 * Gets the user's credits
 *
 * @param userId - The user ID to fetch
 * @param tx - Optional Prisma transaction client for transaction support
 * @returns The user's credits as a number
 */
export async function getUserCredits(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const { _sum } = await tx.creditTransaction.aggregate({
    where: { userId, organizationId: null },
    _sum: {
      amount: true,
    },
  });

  return convertCentsToCredits(_sum.amount ?? BigInt(0));
}
