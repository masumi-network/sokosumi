"use server";

import {
  getInvitationById,
  getMemberByUserIdAndOrganizationId,
  InvitationWithRelations,
} from "@/lib/db";

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
