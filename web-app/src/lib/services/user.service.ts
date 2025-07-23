import "server-only";

import { getSession } from "@/lib/auth/utils";
import prisma from "@/lib/db/repositories/prisma";
import { Prisma, User } from "@/prisma/generated/client";

/**
 * Service for user-related database operations.
 *
 * Provides methods to retrieve and update user records, including
 * support for transactional operations via a Prisma transaction client.
 */
export class UserService {
  /**
   * Create a new UserService instance for transactional operations.
   *
   * @param client - Prisma transaction client to use for all queries.
   * @private
   */
  private constructor(protected client: Prisma.TransactionClient) {}

  /**
   * Create a new UserService instance using a provided Prisma transaction client.
   *
   * Use this method within a transaction to ensure all user operations
   * are performed atomically.
   *
   * @param client - Prisma transaction client.
   * @returns A new UserService instance bound to the provided client.
   */
  static createInstance(client: Prisma.TransactionClient): UserService {
    return new UserService(client);
  }

  /**
   * Singleton instance of UserService using the default Prisma client.
   * Use this for non-transactional operations.
   */
  private static instance?: UserService;

  /**
   * Get the singleton UserService instance using the default Prisma client.
   *
   * @returns The singleton UserService instance.
   */
  public static getInstance(): UserService {
    UserService.instance ??= new UserService(prisma);
    return UserService.instance;
  }

  /**
   * Get the currently authenticated user from the database.
   *
   * Uses the current session to identify the user and fetches their record.
   * Returns null if no user is authenticated or found.
   *
   * @returns The authenticated User object, or null if not authenticated or not found.
   */
  async getMe(): Promise<User | null> {
    const session = await getSession();
    if (!session?.user) return null;
    return this.client.user.findUnique({ where: { id: session.user.id } });
  }

  /**
   * Retrieve a user by their unique user ID.
   *
   * @param id - The user's unique identifier.
   * @returns The User object if found, or null if not found.
   */
  async getUserById(id: string): Promise<User | null> {
    return this.client.user.findUnique({ where: { id } });
  }

  /**
   * Retrieve a user by their email address.
   *
   * @param email - The user's email address.
   * @returns The User object if found, or null if not found.
   */
  async getUserByEmail(email: string): Promise<User | null> {
    return this.client.user.findUnique({ where: { email } });
  }

  /**
   * Update the Stripe customer ID for a user.
   *
   * Associates or disassociates a Stripe customer with a user in the system.
   *
   * @param userId - The user's unique identifier.
   * @param stripeCustomerId - The Stripe customer ID to associate, or null to remove it.
   * @returns The updated User object.
   * @throws If the user does not exist.
   */
  async setUserStripeCustomerId(
    userId: string,
    stripeCustomerId: string | null,
  ): Promise<User> {
    return this.client.user.update({
      where: { id: userId },
      data: { stripeCustomerId },
    });
  }
}
