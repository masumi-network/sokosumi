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
   * Retrieves a user by their email address.
   *
   * @param email - The email address of the user.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the User object if found, or null otherwise.
   */
  getUserByEmail: async (
    email: string,
    tx: Prisma.TransactionClient,
  ): Promise<User | null> => {
    return tx.user.findUnique({ where: { email } });
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
   * Retrieves all users that do not have a Stripe customer ID.
   *
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to an array of User objects without Stripe customer IDs.
   */
  getUsersWithoutStripeCustomerId: async (
    tx: Prisma.TransactionClient,
  ): Promise<User[]> => {
    return tx.user.findMany({
      where: {
        stripeCustomerId: null,
      },
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
   * Retrieves a page of user IDs ordered by ID, starting after an optional cursor.
   *
   * @param cursorId - The last processed user ID, or null to start from the beginning.
   * @param limit - The maximum number of users to return.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to an array of users containing only IDs.
   */
  getUsersBatchAfterCursor: async (
    cursorId: string | null,
    limit: number,
    tx: Prisma.TransactionClient,
  ): Promise<Array<Pick<User, "id">>> => {
    return tx.user.findMany({
      where: cursorId
        ? {
            id: {
              gt: cursorId,
            },
          }
        : undefined,
      orderBy: {
        id: "asc",
      },
      select: {
        id: true,
      },
      take: limit,
    });
  },

  /**
   * Updates the termsAccepted status for a user.
   *
   * @param userId - The unique identifier of the user.
   * @param termsAccepted - The new terms accepted status to set.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the updated User object.
   */
  updateTermsAccepted: async (
    userId: string,
    termsAccepted: boolean,
    tx: Prisma.TransactionClient,
  ): Promise<User> => {
    return tx.user.update({ where: { id: userId }, data: { termsAccepted } });
  },

  /**
   * Updates the marketingOptIn status for a user.
   *
   * @param userId - The unique identifier of the user.
   * @param marketingOptIn - The new marketing opt in status to set.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the updated User object.
   */
  updateMarketingOptIn: async (
    userId: string,
    marketingOptIn: boolean,
    tx: Prisma.TransactionClient,
  ): Promise<User> => {
    return tx.user.update({ where: { id: userId }, data: { marketingOptIn } });
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
