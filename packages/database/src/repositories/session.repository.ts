import type { Prisma } from "../generated/prisma/client.js";

/**
 * Repository for Better Auth session records.
 */
export const sessionRepository = (() => {
  /**
   * Returns the most recent session activity timestamp per user,
   * derived from the latest `updatedAt` across all sessions.
   */
  async function getLastSeenAtByUserIds(
    userIds: string[],
    tx: Prisma.TransactionClient,
  ): Promise<Map<string, Date>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const results = await tx.session.groupBy({
      by: ["userId"],
      where: {
        userId: {
          in: userIds,
        },
      },
      _max: {
        updatedAt: true,
      },
    });

    const lastSeenAtByUserId = new Map<string, Date>();
    for (const result of results) {
      const lastSeenAt = result._max.updatedAt;
      if (lastSeenAt) {
        lastSeenAtByUserId.set(result.userId, lastSeenAt);
      }
    }

    return lastSeenAtByUserId;
  }

  return {
    getLastSeenAtByUserIds,
  };
})();
