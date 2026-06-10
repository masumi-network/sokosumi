import "server-only";

import type {
  InvitationWithRelations,
  JobWithSokosumiStatus,
  Member,
  MemberWithOrganization,
  OrganizationWithRelations,
  User,
} from "@sokosumi/database";
import { headers } from "next/headers";
import { cache } from "react";

import { mapCoreJobSummaryToJobWithSokosumiStatus } from "@/lib/agents/core-dto-mappers";
import { auth, type Session } from "@/lib/auth/auth";
import { getSession } from "@/lib/auth/utils";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type { Organization } from "@/lib/clients/generated/core";

function mapCoreOrganizationToOrganizationWithRelations(
  organization: Organization,
  stripeCustomerId: string | null,
  memberCount: number,
): OrganizationWithRelations {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    logo: organization.logo || null,
    metadata: organization.metadata
      ? JSON.stringify(organization.metadata)
      : null,
    createdAt: organization.createdAt,
    stripeCustomerId,
    _count: { members: memberCount },
  };
}

function sortJobsByCreatedAtDesc(
  jobs: JobWithSokosumiStatus[],
): JobWithSokosumiStatus[] {
  return [...jobs].sort(
    (firstJob, secondJob) =>
      new Date(secondJob.createdAt).getTime() -
      new Date(firstJob.createdAt).getTime(),
  );
}

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
    const session = await getSession();
    if (!session) {
      return null;
    }

    const response = await coreClient.getMe();
    return response.data as User;
  }

  /**
   * Retrieves the active organization ID for the currently authenticated user.
   *
   * - Returns the organization ID if the user has an active organization in their session.
   * - Returns null or undefined if there is no active organization or no session.
   *
   * @returns {Promise<string | null>} The active organization ID, or null if not set.
   */
  async function getActiveOrganizationId(): Promise<string | null> {
    const session = await getSession();
    if (!session) {
      return null;
    }
    return session.session.activeOrganizationId ?? null;
  }

  async function getActiveOrganization(): Promise<OrganizationWithRelations | null> {
    const activeOrganizationId = await getActiveOrganizationId();
    if (!activeOrganizationId) {
      return null;
    }

    const [organizationResponse, stripeCustomerResponse, membersResponse] =
      await Promise.all([
        coreClient.getOrganizationById(activeOrganizationId),
        coreClient.getOrganizationStripeCustomer(activeOrganizationId),
        coreClient.getOrganizationMembers(activeOrganizationId),
      ]);

    return mapCoreOrganizationToOrganizationWithRelations(
      organizationResponse.data,
      stripeCustomerResponse.data.stripeCustomerId,
      membersResponse.data.length,
    );
  }

  /**
   * Retrieves jobs for the currently authenticated user filtered by agent ID.
   * If the user has an active organization, returns jobs in that organization context.
   * Otherwise, returns personal jobs for the user and agent.
   *
   * @param {string} agentId - The ID of the agent to filter jobs by.
   * @returns {Promise<JobWithSokosumiStatus[]>} An array of jobs with status for the user and agent.
   *
   */
  async function getMyJobs(agentId: string): Promise<JobWithSokosumiStatus[]> {
    const session = await getSession();
    if (!session) {
      return [];
    }

    const response = await coreClient.getMyJobs(agentId);
    return sortJobsByCreatedAtDesc(
      response.data.map((job) => mapCoreJobSummaryToJobWithSokosumiStatus(job)),
    );
  }

  /**
   * Retrieves all organization memberships for the currently authenticated user.
   * Deduplicated per request via React cache() when used in Server Components
   * (e.g. ProfileSwitch, UserAvatar on every page).
   *
   * @returns A promise that resolves to an array of MemberWithOrganization objects for the current user.
   */
  const getMyMembersWithOrganizations = cache(
    async (): Promise<MemberWithOrganization[]> => {
      const session = await getSession();
      if (!session) {
        return [];
      }
      const response = await coreClient.getMyMembersWithOrganizations();
      return response.data;
    },
  );

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
    const session = await getSession();
    if (!session) {
      return null;
    }
    const response = await coreClient.getMyMemberInOrganization(organizationId);
    return response?.data ?? null;
  }

  /**
   * Retrieves all valid pending invitations for the currently authenticated user.
   *
   * @returns A promise that resolves to an array of InvitationWithRelations objects for the current user.
   */
  async function getMyValidPendingInvitations(): Promise<
    InvitationWithRelations[]
  > {
    const session = await getSession();
    if (!session) {
      return [];
    }

    try {
      const response = await coreClient.getMyPendingInvitations();
      return response.data as InvitationWithRelations[];
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Determines whether the onboarding flow should be shown for the current user.
   *
   * Logic:
   * - If the user's `onboardingCompleted` is already true → returns false
   * - If the user is a member of any organization → sets `onboardingCompleted` and returns false
   * - Otherwise → returns true (show onboarding)
   */
  async function showOnboarding(session: Session): Promise<boolean> {
    if (!session) {
      return false;
    }

    const user = session.user;
    if (!user) {
      return false;
    }

    if (user.onboardingCompleted) {
      return false;
    }

    try {
      const onboardingResponse = await coreClient.getMyOnboarding();
      if (onboardingResponse.data.completed) {
        return false;
      }

      const membersResponse = await coreClient.getMyMembersWithOrganizations();
      if (membersResponse.data.length > 0) {
        await coreClient.completeMyOnboarding();
        return false;
      }

      return true;
    } catch (error) {
      console.error("Failed to check/update onboarding status", error);
      // Return true (show onboarding) on error as a safe default - better to show
      // onboarding than to silently skip it due to a transient DB error
      return true;
    }
  }

  /**
   * Checks which of the provided emails already have user accounts.
   *
   * @param emails - Array of email addresses to check.
   * @returns Promise resolving to array of emails that already have user accounts.
   */
  async function checkExistingUsers(emails: string[]): Promise<string[]> {
    const normalizedEmails = Array.from(
      new Set(
        emails.map((e) => e.trim().toLowerCase()).filter((e) => e.length > 0),
      ),
    );

    if (normalizedEmails.length === 0) {
      return [];
    }

    try {
      const response = await coreClient.checkExistingUsers(normalizedEmails);
      return response.data.existingEmails.map((email) => email.toLowerCase());
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Marks the onboarding as completed for a specific user.
   *
   * @param userId - The ID of the user to update.
   * @param cookie - Session cookie for authentication.
   * @returns Promise that resolves when the update is complete.
   */
  async function markOnboardingCompleteForMe(): Promise<void> {
    const session = await getSession();
    if (!session) {
      return;
    }

    // Update via Better Auth to keep session in sync (cookie cache, etc.)
    // This has to be done, because the screen wasn't getting synced with the DB causing users to keep in the same screen.
    await auth.api.updateUser({
      headers: await headers(),
      body: { onboardingCompleted: true },
    });
  }

  return {
    getMe,
    getActiveOrganizationId,
    getActiveOrganization,
    getMyJobs,
    getMyMembersWithOrganizations,
    getMyMemberInOrganization,
    getMyValidPendingInvitations,
    showOnboarding,
    checkExistingUsers,
    markOnboardingCompleteForMe,
  };
})();
