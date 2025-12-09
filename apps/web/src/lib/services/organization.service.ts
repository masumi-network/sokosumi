import "server-only";

import {
  Invitation,
  InvitationWithRelations,
  MemberRole,
  MemberWithUser,
} from "@sokosumi/database";
import {
  invitationRepository,
  memberRepository,
} from "@sokosumi/database/repositories";
import { nanoid } from "nanoid";
import { headers } from "next/headers";
import slugify from "slugify";

import { auth } from "@/lib/auth/auth";
import { getAuthContext } from "@/lib/auth/utils";

/**
 * Service for organization and invitations related operations.
 * Provides methods to get members and pending invitations for the current user.
 */
export const organizationService = (() => {
  /**
   * Generates a unique, URL-friendly slug for an organization based on its name.
   *
   * - Converts the provided name to a lowercase, strict slug.
   * - Appends a unique 6-character ID to ensure uniqueness.
   *
   * @param name - The name of the organization to generate a slug for.
   * @returns A unique, URL-safe slug string for the organization.
   */
  async function generateOrganizationSlugFromName(name: string) {
    const slugedName = slugify(name, { lower: true, strict: true });
    const uniqueId = nanoid(6).toLowerCase();
    return `${slugedName}-${uniqueId}`;
  }

  /**
   * Retrieves a pending invitation by its ID.
   *
   * @param id - The ID of the invitation to retrieve.
   * @returns A promise that resolves to the invitation if found, or an error if not found or expired.
   */
  async function getPendingInvitation(id: string): Promise<
    | {
        error: PendingInvitationErrorCode;
      }
    | {
        error?: never;
        invitation: InvitationWithRelations;
      }
  > {
    const invitation = await invitationRepository.getPendingInvitationById(id);

    if (!invitation) {
      return {
        error: PendingInvitationErrorCode.NOT_FOUND,
      };
    }

    if (invitation.expiresAt < new Date()) {
      return {
        error: PendingInvitationErrorCode.EXPIRED,
      };
    }

    const inviterMember =
      await memberRepository.getMemberByUserIdAndOrganizationId(
        invitation.inviterId,
        invitation.organizationId,
      );

    if (!inviterMember) {
      return {
        error: PendingInvitationErrorCode.INVITER_NOT_FOUND,
      };
    }

    return {
      invitation,
    };
  }

  /**
   * Retrieves members of an organization along with their associated user data.
   *
   * - Requires the current session to be valid.
   * - Checks if the current user is a member of the specified organization.
   * - Supports pagination via the `params` argument.
   *
   * @param organizationId - The ID of the organization whose members are to be retrieved.
   * @returns A promise that resolves to an array of MemberWithUser objects.
   * @throws Error with code "NOT_AUTHORIZED" if the user is not a member of the organization.
   */
  async function getOrganizationMembersWithUser(
    organizationId: string,
  ): Promise<MemberWithUser[]> {
    const context = await getAuthContext();
    if (!context) {
      return [];
    }
    const userId = context.userId;

    // Check if the user is a member of the organization
    const myMemberInOrganization =
      await memberRepository.getMemberByUserIdAndOrganizationId(
        userId,
        organizationId,
      );
    if (!myMemberInOrganization) {
      console.error("You are not the member of the organization");
      throw new Error("NOT_AUTHORIZED");
    }

    const members = await memberRepository.getMembersWithUser({
      organizationId,
    });

    return members;
  }

  async function getPendingInvitations(
    organizationId: string,
  ): Promise<Invitation[]> {
    const invitations =
      await invitationRepository.getPendingInvitationsByOrganizationId(
        organizationId,
      );
    // Group by email and take the first (latest) invitation per email
    const emailMap = new Map<string, Invitation>();
    for (const invitation of invitations) {
      if (!emailMap.has(invitation.email)) {
        emailMap.set(invitation.email, invitation);
      }
    }
    return Array.from(emailMap.values());
  }

  /**
   * Creates an organization with the specified user as owner.
   *
   * @param name - The name of the organization.
   * @param userId - The ID of the user who will own the organization.
   * @returns Promise that resolves to the created organization or null if failed.
   */
  async function createOrganizationWithOwner(name: string, userId: string) {
    const slug = await generateOrganizationSlugFromName(name);
    const headersList = await headers();

    return await auth.api.createOrganization({
      body: {
        name,
        slug,
        userId,
      },
      headers: headersList,
    });
  }

  /**
   * Invites multiple members to an organization in batch.
   *
   * @param organizationId - The ID of the organization.
   * @param emails - Array of email addresses to invite.
   * @param role - The role to assign to invited members.
   * @returns Promise that resolves when all invitations are sent.
   */
  async function inviteMultipleMembers(
    organizationId: string,
    emails: string[],
    role: MemberRole,
  ): Promise<void> {
    const headersList = await headers();

    for (const email of emails) {
      await auth.api.createInvitation({
        body: {
          email,
          role,
          organizationId,
          resend: true,
        },
        headers: headersList,
      });
    }
  }

  return {
    generateOrganizationSlugFromName,
    getPendingInvitation,
    getPendingInvitations,
    getOrganizationMembersWithUser,
    createOrganizationWithOwner,
    inviteMultipleMembers,
  };
})();

/**
 * Error codes for pending invitations.
 */
export enum PendingInvitationErrorCode {
  EXPIRED = "EXPIRED",
  NOT_FOUND = "NOT_FOUND",
  INVITER_NOT_FOUND = "INVITER_NOT_FOUND",
}
