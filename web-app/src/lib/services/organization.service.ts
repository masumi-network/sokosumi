import "server-only";

import { nanoid } from "nanoid";
import slugify from "slugify";

import { getSession } from "@/lib/auth/utils";
import { InvitationWithRelations, MemberRole, MemberWithUser } from "@/lib/db";
import { invitationRepository, memberRepository } from "@/lib/db/repositories";
import { Invitation } from "@/prisma/generated/client";

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
    const session = await getSession();
    if (!session) {
      return [];
    }
    const userId = session.user.id;

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

  /**
   * Retrieves pending invitations for an organization.
   *
   * - Fetches the current session and extracts the user ID.
   * - Checks if the user is a member of the organization.
   * - Queries the database for pending invitations of the specified organization.
   *
   * @param organizationId - The ID of the organization to retrieve pending invitations for.
   * @returns A promise that resolves to an array of Invitation objects.
   */
  async function getOrganizationPendingInvitations(
    organizationId: string,
  ): Promise<Invitation[]> {
    const session = await getSession();
    if (!session) {
      return [];
    }
    const userId = session.user.id;

    const myMemberInOrganization =
      await memberRepository.getMemberByUserIdAndOrganizationId(
        userId,
        organizationId,
      );
    if (!myMemberInOrganization) {
      console.error("You are not from the organization");
      throw new Error("UNAUTHORIZED");
    }
    const isOwnerOrAdmin =
      myMemberInOrganization.role === MemberRole.OWNER ||
      myMemberInOrganization.role === MemberRole.ADMIN;
    if (!isOwnerOrAdmin) {
      console.error("You are not owner or admin of the organization");
      throw new Error("UNAUTHORIZED");
    }

    return await invitationRepository.getPendingInvitationsByOrganizationId(
      organizationId,
    );
  }

  return {
    generateOrganizationSlugFromName,
    getPendingInvitation,
    getOrganizationMembersWithUser,
    getOrganizationPendingInvitations,
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
