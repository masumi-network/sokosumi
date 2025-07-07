import "server-only";

import { nanoid } from "nanoid";
import slugify from "slugify";

import { getSessionOrThrow } from "@/lib/auth/utils";
import { MemberWithOrganization } from "@/lib/db";
import {
  retrieveMemberByUserIdAndOrganizationId,
  retrieveMembersWithOrganizationByUserId,
  retrieveMembersWithUser,
  retrieveOrganizationWithRelationsById,
  retrieveOrganizationWithRelationsBySlug,
  retrievePendingInvitationsByOrganizationId,
} from "@/lib/db/repositories";
import { Invitation, Member } from "@/prisma/generated/client";

/**
 * Generates a unique, URL-friendly slug for an organization based on its name.
 *
 * - Converts the provided name to a lowercase, strict slug.
 * - Checks if an organization with the generated slug already exists.
 *   - If not, returns the slug.
 *   - If it exists, appends a unique 6-character ID to ensure uniqueness.
 *
 * @param name - The name of the organization to generate a slug for.
 * @returns A unique, URL-safe slug string for the organization.
 */
export async function generateOrganizationSlugFromName(name: string) {
  const slugedName = slugify(name, { lower: true, strict: true });
  const existingOrganization =
    await retrieveOrganizationWithRelationsBySlug(slugedName);
  if (!existingOrganization) {
    return slugedName;
  }

  const uniqueId = nanoid(6);
  return `${slugedName}-${uniqueId}`;
}

/**
 * Retrieves all organization memberships for the currently authenticated user.
 *
 * - Fetches the current session and extracts the user ID.
 * - Returns a list of member records, each including associated organization data.
 *
 * @returns A promise that resolves to an array of MemberWithOrganization objects for the current user.
 */
export async function listMyMembers(): Promise<MemberWithOrganization[]> {
  const session = await getSessionOrThrow();
  const userId = session.user.id;

  return await retrieveMembersWithOrganizationByUserId(userId);
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
export async function getMyMemberInOrganization(
  organizationId: string,
): Promise<Member | null> {
  const session = await getSessionOrThrow();
  const userId = session.user.id;

  const member = await retrieveMemberByUserIdAndOrganizationId(
    userId,
    organizationId,
  );

  return member;
}

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
  if (!myMemberInOrganization) {
    console.error("You are not the member of the organization");
    throw new Error("NOT_AUTHORIZED");
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

  const organization = await retrieveOrganizationWithRelationsById(
    session.session.activeOrganizationId,
  );

  return organization;
}
