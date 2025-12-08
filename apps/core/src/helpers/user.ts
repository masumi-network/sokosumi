import type { Prisma, User } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";

import { convertCentsToCredits } from "./credits";

export type UserWithCredits = User & { credits: number };

/**
 * Fetches a user by ID with their credit balance
 *
 * @param userId - The user ID to fetch
 * @param tx - Optional Prisma transaction client for transaction support
 * @returns User with credits converted from cents
 * @throws {notFound} If user doesn't exist
 */
export async function getUserWithCredits(
  user: User,
  tx: Prisma.TransactionClient = prisma,
): Promise<UserWithCredits> {
  const { _sum } = await tx.creditTransaction.aggregate({
    where: { userId: user.id, organizationId: null },
    _sum: {
      amount: true,
    },
  });

  return {
    ...user,
    credits: convertCentsToCredits(_sum.amount ?? BigInt(0)),
  };
}
