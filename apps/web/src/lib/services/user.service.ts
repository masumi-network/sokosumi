import "server-only";

import type { Session } from "@sokosumi/utils";
import { cache } from "react";
import { getSession } from "@/lib/auth/auth.server";
import { updateCurrentUserViaCore } from "@/lib/auth/core-auth-http.server";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type {
  Member,
  MemberRecord,
  MemberWithOrganization,
  Organization,
} from "@/lib/clients/generated/core";

/**
 * Service for user-related operations.
 */
export const userService = (() => {
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

  /**
   * Retrieves the active organization (from Core) for the currently
   * authenticated user. Deduplicated per request via React cache() because it
   * runs in the root layout (and other Server Components) on every render.
   *
   * Returns null when no active organization is set, when Core does not know
   * the organization (404), or when the caller is no longer a member of it
   * (403, e.g. a stale `activeOrganizationId` after a revoked membership).
   */
  const getActiveOrganization = cache(
    async (): Promise<Organization | null> => {
      const activeOrganizationId = await getActiveOrganizationId();
      if (!activeOrganizationId) {
        return null;
      }

      try {
        // coreClient.getOrganizationById already maps Core 404 -> null.
        const response =
          await coreClient.getOrganizationById(activeOrganizationId);
        return response?.data ?? null;
      } catch (error) {
        if (error instanceof CoreApiRequestError && error.status === 403) {
          return null;
        }
        throw error;
      }
    },
  );

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
  ): Promise<MemberRecord | null> {
    const session = await getSession();
    if (!session) {
      return null;
    }
    const response = await coreClient.getMyMemberInOrganization(organizationId);
    return response?.data ?? null;
  }

  const getOrganizationMembers = cache(
    async (organizationId: string): Promise<Member[]> => {
      const session = await getSession();
      if (!session) {
        return [];
      }
      const response = await coreClient.getOrganizationMembers(organizationId);
      return response.data;
    },
  );

  /**
   * Whether the signup onboarding page should run for this session.
   *
   * Membership is not a substitute for completion: invite-join and mid-flow
   * create-organization both leave `onboardingCompleted` false while the user
   * already has a team. Auto-completing on membership used to skip the joined
   * profile steps and the plan step after org creation. Completing the flag is
   * owned by `completeOnboarding` / `markOnboardingCompleteForMe` only.
   */
  async function showOnboarding(session: Session): Promise<boolean> {
    if (!session?.user) {
      return false;
    }

    return !session.user.onboardingCompleted;
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

    // Update via Core Better Auth HTTP to keep session in sync (cookie cache, etc.)
    // This has to be done, because the screen wasn't getting synced with the DB causing users to keep in the same screen.
    await updateCurrentUserViaCore({ onboardingCompleted: true });
  }

  return {
    getActiveOrganizationId,
    getActiveOrganization,
    getMyMembersWithOrganizations,
    getMyMemberInOrganization,
    getOrganizationMembers,
    showOnboarding,
    markOnboardingCompleteForMe,
  };
})();
