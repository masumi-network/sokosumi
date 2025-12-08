import type { Prisma, User as DatabaseUser } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";

import { type User, userSchema } from "@/schemas/user.schema";

import { convertCentsToCredits } from "./credits";

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
