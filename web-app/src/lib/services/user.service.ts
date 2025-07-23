import "server-only";

import { getSession } from "@/lib/auth/utils";
import prisma from "@/lib/db/repositories/prisma";
import { Prisma, User } from "@/prisma/generated/client";

/**
 * Service for interacting with User data in the database.
 *
 * Provides methods to retrieve and update user information, including
 * authenticated user lookup and Stripe customer ID management.
 */
export class UserService {
  /**
   * Constructs a new UserService instance.
   *
   * @param client - Optional Prisma transaction client for transactional operations.
   *                 Defaults to the main Prisma client if not provided.
   */
  constructor(protected client: Prisma.TransactionClient = prisma) {}

  /**
   * Retrieves the current authenticated user's data.
   *
   * Uses the session to identify the user and fetches their record from the database.
   *
   * @returns A promise that resolves to the User object for the authenticated user,
   *          or null if the user is not found.
   * @throws Will throw an error if no valid session is found.
   */
  async getMe(): Promise<User | null> {
    const session = await getSession();
    if (!session?.user) {
      return null;
    }
    return this.client.user.findUnique({ where: { id: session.user.id } });
  }

  /**
   * Retrieves a user by their unique ID.
   *
   * @param id - The unique identifier of the user.
   * @returns A promise that resolves to the User object if found, or null if not found.
   */
  async getUserById(id: string): Promise<User | null> {
    return this.client.user.findUnique({ where: { id } });
  }

  /**
   * Updates the Stripe customer ID for a user identified by their email address.
   *
   * This method is typically used to associate or disassociate a Stripe customer
   * with a user in the system.
   *
   * @param email - The email address of the user to update.
   * @param stripeCustomerId - The Stripe customer ID to associate with the user, or null to remove it.
   * @returns A promise that resolves to the updated User object.
   * @throws Will throw an error if the user with the specified email does not exist.
   */
  async setUserStripeCustomerId(
    email: string,
    stripeCustomerId: string | null,
  ): Promise<User> {
    return this.client.user.update({
      where: { email },
      data: { stripeCustomerId },
    });
  }
}
