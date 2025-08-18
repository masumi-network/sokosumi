import prisma from "@/lib/db/repositories/prisma";
import { Prisma, User } from "@/prisma/generated/client";

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
    tx: Prisma.TransactionClient = prisma,
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
    tx: Prisma.TransactionClient = prisma,
  ): Promise<User | null> => {
    return tx.user.findUnique({ where: { email } });
  },

  /**
   * Updates the Stripe customer ID associated with a user.
   *
   * @param userId - The unique identifier of the user.
   * @param stripeCustomerId - The Stripe customer ID to associate, or null to remove it.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the updated User object.
   */
  setUserStripeCustomerId: async (
    userId: string,
    stripeCustomerId: string | null,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<User> => {
    return tx.user.update({
      where: { id: userId },
      data: { stripeCustomerId },
    });
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
    tx: Prisma.TransactionClient = prisma,
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
    tx: Prisma.TransactionClient = prisma,
  ): Promise<User[]> => {
    return tx.user.findMany({
      where: {
        stripeCustomerId: null,
      },
    });
  },

  /**
   * Updates the terms accepted status for a user.
   *
   * @param userId - The unique identifier of the user.
   * @param termsAccepted - The new terms accepted status.
   * @param tx - (Optional) The Prisma transaction client to use. Defaults to the main Prisma client.
   * @returns A promise that resolves to the updated User object.
   */
  updateUserTermsAccepted: async (
    userId: string,
    termsAccepted: boolean,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<User> => {
    return tx.user.update({ where: { id: userId }, data: { termsAccepted } });
  },
};
