import "server-only";

import { getSession } from "@/lib/auth/utils";
import { JobWithStatus } from "@/lib/db";
import { jobRepository, userRepository } from "@/lib/db/repositories";
import { User } from "@/prisma/generated/client";

/**
 * Service for user-related operations.
 */
export const userService = (() => {
  return {
    /**
     * Retrieves the currently authenticated user from the session.
     *
     * @returns {Promise<User | null>} The user object if authenticated, otherwise null.
     *
     */
    getMe: async (): Promise<User | null> => {
      const session = await getSession();
      if (!session?.user) return null;
      return userRepository.getUserById(session.user.id);
    },

    /**
     * Retrieves the active organization ID for the currently authenticated user.
     *
     * - Returns the organization ID if the user has an active organization in their session.
     * - Returns null or undefined if there is no active organization or no session.
     *
     * @returns {Promise<string | null | undefined>} The active organization ID, or null/undefined if not set.
     */
    async getActiveOrganizationId(): Promise<string | null | undefined> {
      const session = await getSession();
      return session?.session.activeOrganizationId;
    },

    /**
     * Retrieves jobs for the currently authenticated user filtered by agent ID.
     * If the user has an active organization, returns jobs associated with that organization.
     * Otherwise, returns personal jobs for the user and agent.
     *
     * @param {string} agentId - The ID of the agent to filter jobs by.
     * @returns {Promise<JobWithStatus[]>} An array of jobs with status for the user and agent.
     *
     */
    async getMyJobs(agentId: string): Promise<JobWithStatus[]> {
      const session = await getSession();
      if (!session) return [];

      const userId = session.user.id;
      const activeOrganizationId = session.session.activeOrganizationId;

      if (activeOrganizationId) {
        // Show jobs for the specific organization
        return await jobRepository.getJobsByAgentIdUserIdAndOrganizationId(
          agentId,
          userId,
          activeOrganizationId,
        );
      } else {
        // Show personal jobs only (without organization context)
        return await jobRepository.getPersonalJobsByAgentIdAndUserId(
          agentId,
          userId,
        );
      }
    },
  };
})();
