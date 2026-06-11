import "server-only";

import type {
  Member,
  MemberWithOrganization,
  OrganizationWithRelations,
} from "@sokosumi/database";
import {
  memberRepository,
  organizationRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { headers } from "next/headers";
import { cache } from "react";

import { auth, type Session } from "@/lib/auth/auth";
import { getSession } from "@/lib/auth/utils";
import { coreClient } from "@/lib/clients/core.client";
import prisma from "@/lib/db/prisma";

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

  async function getActiveOrganization(): Promise<OrganizationWithRelations | null> {
    const activeOrganizationId = await getActiveOrganizationId();
    if (!activeOrganizationId) {
      return null;
    }

    const organization =
      await organizationRepository.getOrganizationWithRelationsById(
        activeOrganizationId,
        prisma,
      );
    return organization;
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
      return await prisma.$transaction(async (tx) => {
        const membershipOrgIds =
          await memberRepository.getMembersOrganizationIdsByUserId(user.id, tx);

        if (membershipOrgIds.length > 0) {
          await userRepository.updateUserOnboardingCompleted(user.id, true, tx);
          return false;
        }

        return true;
      });
    } catch (error) {
      console.error("Failed to check/update onboarding status", error);
      // Return true (show onboarding) on error as a safe default - better to show
      // onboarding than to silently skip it due to a transient DB error
      return true;
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
    getActiveOrganizationId,
    getActiveOrganization,
    getMyMembersWithOrganizations,
    getMyMemberInOrganization,
    showOnboarding,
    markOnboardingCompleteForMe,
  };
})();
