import "server-only";

import { InvitationWithRelations } from "@/lib/db";
import {
  retrieveMemberByUserIdAndOrganizationId,
  retrievePendingInvitationById,
} from "@/lib/db/repositories";

import { InvitationErrorCode } from "./types";

export async function getInvitation(id: string): Promise<
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
