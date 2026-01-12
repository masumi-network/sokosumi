import type { Prisma } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";
import { convertCentsToCredits } from "@sokosumi/database/helpers";

/**
 * Gets credits for a user or organization
 *
 * @param userId - The user ID to fetch
 * @param organizationId - Optional organization ID. If provided, returns organization credits; otherwise returns user credits
 * @param tx - Optional Prisma transaction client for transaction support
 * @returns The credits as a number
 */
export async function getCredits(
  userId: string,
  organizationId: string | null,
  tx: Prisma.TransactionClient = prisma,
): Promise<number> {
  const where = organizationId
    ? { userId, organizationId }
    : { userId, organizationId: null };

  const { _sum } = await tx.creditTransaction.aggregate({
    where,
    _sum: {
      amount: true,
    },
  });

  return convertCentsToCredits(_sum.amount ?? BigInt(0));
}
