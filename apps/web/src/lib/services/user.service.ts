import "server-only";

import type { Member, Prisma, User } from "@sokosumi/database";
import {
  InvitationWithRelations,
  JobWithSokosumiStatus,
  MemberWithOrganization,
  OrganizationWithRelations,
} from "@sokosumi/database";
import { mapJobWithStatus } from "@sokosumi/database/helpers";
import {
  invitationRepository,
  jobRepository,
  memberRepository,
  organizationRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { jobInclude } from "@sokosumi/database/types/job";
import { headers } from "next/headers";
import { cache } from "react";

import { auth, type Session } from "@/lib/auth/auth";
import { getAuthContext } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";

interface ListMyJobsForActiveContextParams {
  cursor?: string | null;
  limit?: number;
}

interface PaginatedJobsResult {
  jobs: JobWithSokosumiStatus[];
  nextCursor: string | null;
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
    const context = await getAuthContext();
    if (!context) {
      return null;
    }
    return userRepository.getUserById(context.userId, prisma);
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
        prisma,
      );
    return organization;
  }

  /**
   * Retrieves jobs for the currently authenticated user filtered by agent ID.
   * If the user has an active organization, returns jobs associated with that organization.
   * Otherwise, returns personal jobs for the user and agent.
   *
   * @param {string} agentId - The ID of the agent to filter jobs by.
   * @returns {Promise<JobWithSokosumiStatus[]>} An array of jobs with status for the user and agent.
   *
   */
  async function getMyJobs(agentId: string): Promise<JobWithSokosumiStatus[]> {
    const context = await getAuthContext();
    if (!context) {
      return [];
    }
    const userId = context.userId;
    const activeOrganizationId = context.organizationId;

    // Get owned jobs
    const ownedJobs = await jobRepository.getJobs(
      {
        agentId,
        userId,
        organizationId: activeOrganizationId,
      },
      prisma,
    );

    // Get shared jobs from organization if user is in an organization
    let sharedJobs: JobWithSokosumiStatus[] = [];
    if (activeOrganizationId) {
      sharedJobs = await jobRepository.getJobsSharedWithOrganization(
        userId,
        agentId,
        activeOrganizationId,
        prisma,
      );
    }

    // Combine and sort all jobs
    const allJobs = [...ownedJobs, ...sharedJobs];
    return allJobs.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  async function listMyJobsForActiveContextPaginated(
    params: ListMyJobsForActiveContextParams = {},
  ): Promise<PaginatedJobsResult> {
    const { cursor = null, limit = 20 } = params;
    const context = await getAuthContext();
    if (!context) {
      return { jobs: [], nextCursor: null };
    }

    const baseWhere: Prisma.JobWhereInput = {
      OR: [
        {
          userId: context.userId,
          organizationId: context.organizationId,
        },
        ...(context.organizationId
          ? [{ share: { organizationId: context.organizationId } }]
          : []),
      ],
    };

    let where: Prisma.JobWhereInput = baseWhere;
    if (cursor) {
      const cursorJob = await prisma.job.findUnique({
        where: { id: cursor },
        select: { id: true, createdAt: true },
      });

      if (!cursorJob) {
        return { jobs: [], nextCursor: null };
      }

      where = {
        AND: [
          baseWhere,
          {
            OR: [
              { createdAt: { lt: cursorJob.createdAt } },
              {
                createdAt: cursorJob.createdAt,
                id: { lt: cursorJob.id },
              },
            ],
          },
        ],
      };
    }

    const rawJobs = await prisma.job.findMany({
      where,
      include: jobInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const hasMore = rawJobs.length > limit;
    const pageJobs = hasMore ? rawJobs.slice(0, limit) : rawJobs;
    const paginatedJobs = pageJobs.map(mapJobWithStatus);
    const nextCursor = hasMore
      ? (pageJobs[pageJobs.length - 1]?.id ?? null)
      : null;

    return {
      jobs: paginatedJobs,
      nextCursor,
    };
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
      const context = await getAuthContext();
      if (!context) {
        return [];
      }
      return await memberRepository.getMembersWithOrganizationByUserId(
        context.userId,
        prisma,
      );
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
    const context = await getAuthContext();
    if (!context) {
      return null;
    }
    return await memberRepository.getMemberByUserIdAndOrganizationId(
      context.userId,
      organizationId,
      prisma,
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
    return await prisma.$transaction(async (tx) => {
      const user = await userRepository.getUserById(context.userId, tx);
      if (!user?.email) {
        console.error("User email not found");
        return [];
      }

      return await invitationRepository.getValidPendingInvitationsByEmail(
        user.email,
        tx,
      );
    });
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

    const users = await Promise.all(
      normalizedEmails.map((email) =>
        userRepository.getUserByEmail(email, prisma),
      ),
    );

    return users
      .filter((u): u is NonNullable<typeof u> => !!u)
      .map((u) => u.email.toLowerCase());
  }

  /**
   * Marks the onboarding as completed for a specific user.
   *
   * @param userId - The ID of the user to update.
   * @param cookie - Session cookie for authentication.
   * @returns Promise that resolves when the update is complete.
   */
  async function markOnboardingCompleteForMe(): Promise<void> {
    const context = await getAuthContext();
    if (!context) {
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
    listMyJobsForActiveContextPaginated,
    getMyMembersWithOrganizations,
    getMyMemberInOrganization,
    getMyValidPendingInvitations,
    showOnboarding,
    checkExistingUsers,
    markOnboardingCompleteForMe,
  };
})();
