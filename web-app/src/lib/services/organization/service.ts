import "server-only";

import { getSessionOrThrow } from "@/lib/auth/utils";
import { MemberRole } from "@/lib/db";
import {
  retrieveMemberByUserIdAndOrganizationId,
  retrieveMembersWithUser,
  retrievePendingInvitationsByOrganizationId,
} from "@/lib/db/repositories";
import { OrganizationService } from "@/lib/services";
import { Invitation } from "@/prisma/generated/client";

/**
 * Retrieves members of an organization, optionally excluding the current user.
 *
 * - Fetches the current session and extracts the user ID.
 * - Checks if the user is a member of the organization.
 * - Queries the database for members of the specified organization.
 *   - If includeMe is false, excludes the current user from the results.
 *
 * @param organizationId - The ID of the organization to retrieve members for.
 * @param includeMe - Whether to include the current user in the results.
 * @param params - Optional pagination parameters.
 * @returns A promise that resolves to an array of MemberWithUser objects.
 */
export async function getOrganizationMembersWithUser(
  organizationId: string,
  includeMe = false,
  params: {
    page: number;
    limit: number;
  } = {
    page: 1,
    limit: 100,
  },
) {
  const session = await getSessionOrThrow();
  const userId = session.user.id;

  // check if the user is a member of the organization
  const myMemberInOrganization = await retrieveMemberByUserIdAndOrganizationId(
    userId,
    organizationId,
  );
  if (!myMemberInOrganization) {
    console.error("You are not the member of the organization");
    throw new Error("NOT_AUTHORIZED");
  }

  const members = await retrieveMembersWithUser(
    {
      organizationId,
      ...(includeMe ? {} : { userId: { not: userId } }),
    },
    params,
  );

  return members;
}

export async function getOrganizationPendingInvitations(
  organizationId: string,
): Promise<Invitation[]> {
  const session = await getSessionOrThrow();
  const userId = session.user.id;

  const myMemberInOrganization = await retrieveMemberByUserIdAndOrganizationId(
    userId,
    organizationId,
  );
  if (
    !myMemberInOrganization ||
    myMemberInOrganization.role !== MemberRole.ADMIN
  ) {
    console.error("You are not the admin of the organization");
    throw new Error("UNAUTHORIZED");
  }

  return await retrievePendingInvitationsByOrganizationId(organizationId);
}

/**
 * Retrieves the active organization for the current user from their session.
 *
 * - Fetches the current session and extracts the activeOrganizationId.
 * - If no active organization is set, returns null.
 * - Otherwise, retrieves and returns the full organization data.
 *
 * @returns A promise that resolves to the Organization object if found, or null if not set.
 */
export async function getActiveOrganization() {
  const session = await getSessionOrThrow();

  if (!session.session.activeOrganizationId) {
    return null;
  }

  const organization =
    await OrganizationService.getInstance().getOrganizationById(
      session.session.activeOrganizationId,
    );

  return organization;
}
