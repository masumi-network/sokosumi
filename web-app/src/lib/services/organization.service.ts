import "server-only";

import { getSession } from "@/lib/auth/utils";
import { InvitationWithRelations, MemberWithOrganization } from "@/lib/db";
import { invitationRepository, memberRepository } from "@/lib/db/repositories";

/**
 * Service for organization and invitations related operations.
 * Provides methods to get members and pending invitations for the current user.
 */
export const organizationService = (() => {
  /**
   * Retrieves all organization memberships for the currently authenticated user.
   *
   * @returns A promise that resolves to an array of MemberWithOrganization objects for the current user.
   */
  async function getMyMembersWithOrganizations(): Promise<
    MemberWithOrganization[]
  > {
    const session = await getSession();
    if (!session) {
      return [];
    }

    const userId = session.user.id;
    return await memberRepository.getMembersWithOrganizationByUserId(userId);
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

    const userEmail = session.user.email;
    return await invitationRepository.getValidPendingInvitationsByEmail(
      userEmail,
    );
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

  return {
    getMyMembersWithOrganizations,
    getMyValidPendingInvitations,
    getPendingInvitation,
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
