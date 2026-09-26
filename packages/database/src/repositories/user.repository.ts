import type { Prisma, User } from "../generated/prisma/client.js";

/**
 * Case-insensitive name/email match used by the admin overview listing.
 */
function buildUserSearchWhere(trimmed: string): Prisma.UserWhereInput {
  return {
    OR: [
      { name: { contains: trimmed, mode: "insensitive" } },
      { email: { contains: trimmed, mode: "insensitive" } },
    ],
  };
}

export const userRepository = {
  getUserById: async (
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<User | null> => {
    return tx.user.findUnique({ where: { id } });
  },

  getUserByStripeCustomerId: async (
    stripeCustomerId: string,
    tx: Prisma.TransactionClient,
  ): Promise<User | null> => {
    return tx.user.findUnique({
      where: { stripeCustomerId },
    });
  },

  /**
   * Admin overview listing. An empty query lists all users. Ordered
   * newest-first.
   */
  listUsersForAdminOverview: async (
    params: {
      query?: string;
      cursor?: string;
      take: number;
      skip?: number;
    },
    tx: Prisma.TransactionClient,
  ): Promise<{
    users: Array<Pick<User, "id" | "name" | "email" | "createdAt" | "role">>;
    total: number;
  }> => {
    const trimmed = params.query?.trim();
    const where: Prisma.UserWhereInput = trimmed
      ? buildUserSearchWhere(trimmed)
      : {};

    const [users, total] = await Promise.all([
      tx.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
          role: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: params.take,
        skip: params.skip,
        cursor: params.cursor ? { id: params.cursor } : undefined,
      }),
      tx.user.count({ where }),
    ]);

    return { users, total };
  },

  updatePreferredOrganizationId: async (
    userId: string,
    preferredOrganizationId: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<User> => {
    return tx.user.update({
      where: { id: userId },
      data: { preferredOrganizationId },
    });
  },
};
