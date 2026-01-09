import type { Prisma, User as DatabaseUser } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";
import { convertCentsToCredits } from "@sokosumi/database/helpers";

import { type User, userSchema } from "@/schemas/user.schema";

/**
 * Maps a user to a response object
 *
 * @param userId - The user ID to fetch
 * @param tx - Optional Prisma transaction client for transaction support
 * @returns Response object with user data and credits converted from cents
 * @throws {notFound} If user doesn't exist
 */
export async function mapUserToResponse(
  user: DatabaseUser,
  tx: Prisma.TransactionClient = prisma,
): Promise<User> {
  const { _sum } = await tx.creditTransaction.aggregate({
    where: { userId: user.id, organizationId: null },
    _sum: {
      amount: true,
    },
  });

  return userSchema.parse({
    ...user,
    credits: convertCentsToCredits(_sum.amount ?? BigInt(0)),
  });
}

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
