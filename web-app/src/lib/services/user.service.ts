import "server-only";

import { getSession } from "@/lib/auth/utils";
import { User } from "@/prisma/generated/client";

import { BaseService } from "./base.service";

/**
 * Service for user-related database operations.
 *
 * Provides methods to retrieve and update user records, including
 * support for transactional operations via a Prisma transaction client.
 *
 * Usage:
 * - Use `UserService.getInstance()` for singleton access with the default Prisma client.
 * - Use `UserService.createInstance(client)` for transactional operations with a specific Prisma client.
 */
export class UserService extends BaseService<UserService> {
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
