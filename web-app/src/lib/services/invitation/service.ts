import "server-only";

import { getSessionOrThrow } from "@/lib/auth/utils";
import { InvitationWithRelations } from "@/lib/db";
import {
  retrieveMemberByUserIdAndOrganizationId,
  retrievePendingInvitationById,
  retrieveValidPendingInvitationsByEmail,
} from "@/lib/db/repositories";

import { InvitationErrorCode } from "./types";

export async function getPendingInvitation(id: string): Promise<
  | {
      error: InvitationErrorCode;
    }
  | {
      error?: never;
      invitation: InvitationWithRelations;
    }
> {
  const invitation = await retrievePendingInvitationById(id);

  if (!invitation) {
    return {
      error: InvitationErrorCode.NOT_FOUND,
    };
  }

  if (invitation.expiresAt < new Date()) {
    return {
      error: InvitationErrorCode.EXPIRED,
    };
  }

  const inviterMember = await retrieveMemberByUserIdAndOrganizationId(
    invitation.inviterId,
    invitation.organizationId,
  );

  if (!inviterMember) {
    return {
      error: InvitationErrorCode.INVITER_NOT_FOUND,
    };
  }

  return {
    invitation,
  };
}

/**
 * Retrieves all valid pending invitations for the currently authenticated user.
 *
 * - Fetches the current session and extracts the user's email.
 * - Returns a list of invitation records that are pending and not expired.
 *
 * @returns A promise that resolves to an array of InvitationWithRelations objects for the current user.
 */
export async function getMyValidPendingInvitations(): Promise<
  InvitationWithRelations[]
> {
  const session = await getSessionOrThrow();
  const userEmail = session.user.email;

  return await retrieveValidPendingInvitationsByEmail(userEmail);
}
