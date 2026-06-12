import type { Prisma, User } from "../generated/prisma/client.js";

/**
 * Repository for user-related database operations.
 * Provides methods to retrieve and update user records using Prisma.
 */
export const userRepository = {
  /**
   * Retrieves a user by their unique ID.
   *
   * @param id - The unique identifier of the user.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the User object if found, or null otherwise.
   */
  getUserById: async (
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<User | null> => {
    return tx.user.findUnique({ where: { id } });
  },

  /**
   * Get a user by their Stripe customer ID.
   *
   * @param stripeCustomerId - The Stripe customer ID.
   * @param tx - Optional Prisma transaction client.
   * @returns The user if found, null otherwise.
   */
  getUserByStripeCustomerId: async (
    stripeCustomerId: string,
    tx: Prisma.TransactionClient,
  ): Promise<User | null> => {
    return tx.user.findUnique({
      where: { stripeCustomerId },
    });
  },

  /**
   * Searches users by name or email using a case-insensitive partial match.
   *
   * @param query - The search term to match against user name and email.
   * @param limit - The maximum number of users to return.
   * @param tx - The Prisma transaction client to use.
   * @returns A promise that resolves to matching users (id, name, email). An
   *   empty or whitespace-only query resolves to an empty array without querying.
   */
  searchUsers: async (
    query: string,
    limit: number,
    tx: Prisma.TransactionClient,
  ): Promise<Array<Pick<User, "id" | "name" | "email">>> => {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    return tx.user.findMany({
      where: {
        OR: [
          { name: { contains: trimmed, mode: "insensitive" } },
          { email: { contains: trimmed, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
      take: limit,
    });
  },

  /**
   * Paginated user listing for the admin user overview. An empty or missing
   * query lists all users (unlike `searchUsers`, which is a picker and returns
   * nothing for blank queries). Ordered newest-first.
   *
   * @param params - Optional case-insensitive name/email filter plus cursor pagination arguments.
   * @param tx - The Prisma transaction client to use.
   * @returns A promise that resolves to the page of users and the total count for the filter.
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
    users: Array<Pick<User, "id" | "name" | "email" | "createdAt">>;
    total: number;
  }> => {
    const trimmed = params.query?.trim();
    const where: Prisma.UserWhereInput = trimmed
      ? {
          OR: [
            { name: { contains: trimmed, mode: "insensitive" } },
            { email: { contains: trimmed, mode: "insensitive" } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      tx.user.findMany({
        where,
        select: { id: true, name: true, email: true, createdAt: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: params.take,
        skip: params.skip,
        cursor: params.cursor ? { id: params.cursor } : undefined,
      }),
      tx.user.count({ where }),
    ]);

    return { users, total };
  },

  /**
   * Updates the onboarding completed flag for a user.
   *
   * @param userId - The unique identifier of the user.
   * @param onboardingCompleted - The new onboarding completed status.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the updated User object.
   */
  updateUserOnboardingCompleted: async (
    userId: string,
    onboardingCompleted: boolean,
    tx: Prisma.TransactionClient,
  ): Promise<User> => {
    return tx.user.update({
      where: { id: userId },
      data: { onboardingCompleted },
    });
  },

  /**
   * Updates the preferred organization for a user.
   *
   * @param userId - The unique identifier of the user.
   * @param preferredOrganizationId - The preferred organization ID, or null for the personal workspace.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the updated User object.
   */
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

  /**
   * Updates the metadata JSON string for a user.
   *
   * @param userId - The unique identifier of the user.
   * @param metadata - Serialized metadata JSON, or null to clear.
   * @param tx - The Prisma transaction client to use.
   * @returns A promise that resolves to the updated User object.
   */
  updateUserMetadata: async (
    userId: string,
    metadata: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<User> => {
    return tx.user.update({
      where: { id: userId },
      data: { metadata },
    });
  },
};
