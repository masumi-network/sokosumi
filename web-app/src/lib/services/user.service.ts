import "server-only";

import { getAuthContext } from "@/lib/auth/utils";
import {
  InvitationWithRelations,
  JobWithStatus,
  MemberWithOrganization,
  OrganizationWithRelations,
} from "@/lib/db";
import {
  invitationRepository,
  jobRepository,
  memberRepository,
  organizationRepository,
  userRepository,
} from "@/lib/db/repositories";
import { Member, User } from "@/prisma/generated/client";

/**
 * Service for user-related operations.
 */
export const userService = (() => {
  /**
   * Retrieves the currently authenticated user from the session.
   *
   * @returns {Promise<User | null>} The user object if authenticated, otherwise null.
   *
   */
  async function getMe(): Promise<User | null> {
    const context = await getAuthContext();
    if (!context) {
      return null;
    }
    return userRepository.getUserById(context.userId);
  }

  /**
   * Retrieves the active organization ID for the currently authenticated user.
   *
   * - Returns the organization ID if the user has an active organization in their session.
   * - Returns null or undefined if there is no active organization or no session.
   *
   * @returns {Promise<string | null | undefined>} The active organization ID, or null/undefined if not set.
   */
  async function getActiveOrganizationId(): Promise<string | null | undefined> {
    const context = await getAuthContext();
    if (!context) {
      return null;
    }
    return context.organizationId;
  }

  async function getActiveOrganization(): Promise<OrganizationWithRelations | null> {
    const activeOrganizationId = await getActiveOrganizationId();
    if (!activeOrganizationId) {
      return null;
    }

    const organization =
      await organizationRepository.getOrganizationWithRelationsById(
        activeOrganizationId,
      );
    return organization;
  }

  /**
   * Retrieves jobs for the currently authenticated user filtered by agent ID.
   * If the user has an active organization, returns jobs associated with that organization.
   * Otherwise, returns personal jobs for the user and agent.
   *
   * @param {string} agentId - The ID of the agent to filter jobs by.
   * @returns {Promise<JobWithStatus[]>} An array of jobs with status for the user and agent.
   *
   */
  async function getMyJobs(agentId: string): Promise<JobWithStatus[]> {
    const context = await getAuthContext();
    if (!context) {
      return [];
    }
    const userId = context.userId;
    const activeOrganizationId = context.organizationId;

    return await jobRepository.getJobs({
      agentId,
      userId,
      organizationId: activeOrganizationId,
    });
  }

  /**
   * Retrieves all organization memberships for the currently authenticated user.
   *
   * @returns A promise that resolves to an array of MemberWithOrganization objects for the current user.
   */
  async function getMyMembersWithOrganizations(): Promise<
    MemberWithOrganization[]
  > {
    const context = await getAuthContext();
    if (!context) {
      return [];
    }
    return await memberRepository.getMembersWithOrganizationByUserId(
      context.userId,
    );
  }

  /**
   * Retrieves the membership record for the currently authenticated user in a specific organization.
   *
   * - Fetches the current session and extracts the user ID.
   * - Queries the database for a member record that matches the user ID and organization ID.
   *
   * @param organizationId - The ID of the organization to check for membership.
   * @returns A promise that resolves to the Member record if found, or null if not found.
   */
  async function getMyMemberInOrganization(
    organizationId: string,
  ): Promise<Member | null> {
    const context = await getAuthContext();
    if (!context) {
      return null;
    }
    return await memberRepository.getMemberByUserIdAndOrganizationId(
      context.userId,
      organizationId,
    );
  }

  /**
   * Retrieves all valid pending invitations for the currently authenticated user.
   *
   * @returns A promise that resolves to an array of InvitationWithRelations objects for the current user.
   */
  async function getMyValidPendingInvitations(): Promise<
    InvitationWithRelations[]
  > {
    const context = await getAuthContext();
    if (!context) {
      return [];
    }
    const user = await userRepository.getUserById(context.userId);
    if (!user?.email) {
      console.error("User email not found");
      return [];
    }

    return await invitationRepository.getValidPendingInvitationsByEmail(
      user.email,
    );
  }

  return {
    getMe,
    getActiveOrganizationId,
    getActiveOrganization,
    getMyJobs,
    getMyMembersWithOrganizations,
    getMyMemberInOrganization,
    getMyValidPendingInvitations,
  };
})();
