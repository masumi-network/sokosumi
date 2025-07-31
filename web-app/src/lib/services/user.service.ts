import "server-only";

import { getSession } from "@/lib/auth/utils";
import { userRepository } from "@/lib/db/repositories";
import { User } from "@/prisma/generated/client";

/**
 * Service for user-related operations.
 */
export const userService = {
  /**
   * Retrieves the currently authenticated user from the session.
   *
   * @returns {Promise<User | null>} The user object if authenticated, otherwise null.
   *
   * @example
   * const user = await userService.getMe();
   * if (user) {
   *   // User is authenticated
   * }
   */
  getMe: async (): Promise<User | null> => {
    const session = await getSession();
    if (!session?.user) return null;
    return userRepository.getUserById(session.user.id);
  },
};
