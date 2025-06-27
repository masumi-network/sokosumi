import "server-only";

import { getInvitationById } from "@/lib/db/invitation/repo";
import { InvitationWithRelations } from "@/lib/db/invitation/types";
import { getMemberByUserIdAndOrganizationId } from "@/lib/db/member/repo";

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
  const invitation = await getInvitationById(id);

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

  const inviterMember = await getMemberByUserIdAndOrganizationId(
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
