"use server";

import {
  ActionError,
  CommonErrorCode,
  InvitationErrorCode,
} from "@/lib/actions";
import { getSession } from "@/lib/auth/utils";
import { MemberRole } from "@/lib/db";
import {
  invitationRepository,
  memberRepository,
  prisma,
} from "@/lib/db/repositories";
import { Err, Ok, Result } from "@/lib/ts-res";

export async function acceptInvitation(
  invitationId: string,
): Promise<Result<void, ActionError>> {
  let actionError: ActionError = {
    message: "Internal server error",
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
  };

  try {
    const session = await getSession();
    if (!session) {
      return Err({
        message: "Unauthenticated",
        code: CommonErrorCode.UNAUTHENTICATED,
      });
    }
    const userId = session.user.id;

    await prisma.$transaction(async (tx) => {
      const invitation = await invitationRepository.getPendingInvitationById(
        invitationId,
        tx,
      );
      if (!invitation) {
        actionError = {
          message: "Invitation not found",
          code: InvitationErrorCode.INVITATION_NOT_FOUND,
        };
        throw new Error("Invitation not found");
      }
      const { organizationId, inviterId } = invitation;

      // check inviter member
      const inviterMember =
        await memberRepository.getMemberByUserIdAndOrganizationId(
          inviterId,
          organizationId,
          tx,
        );
      if (!inviterMember) {
        actionError = {
          message: "Inviter member not found",
          code: InvitationErrorCode.INVITER_NOT_FOUND,
        };
        throw new Error("Inviter member not found");
      }

      // accept invitation by invitation id
      await invitationRepository.acceptPendingInvitationById(invitationId, tx);

      // check if user is already member
      const member = await memberRepository.getMemberByUserIdAndOrganizationId(
        userId,
        organizationId,
        tx,
      );
      if (member) {
        actionError = {
          message: "You are already member of this organization.",
          code: InvitationErrorCode.ALREADY_MEMBER,
        };
        throw new Error("You are already member of this organization.");
      }

      // create organization member
      await memberRepository.createMember(
        userId,
        organizationId,
        MemberRole.MEMBER,
        tx,
      );
    });

    return Ok();
  } catch (error) {
    console.error("Failed to accept invitation", error);

    return Err(actionError);
  }
}

export async function rejectInvitation(
  invitationId: string,
): Promise<Result<void, ActionError>> {
  let actionError: ActionError = {
    message: "Internal server error",
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
  };

  try {
    const session = await getSession();
    if (!session) {
      return Err({
        message: "Unauthenticated",
        code: CommonErrorCode.UNAUTHENTICATED,
      });
    }

    await prisma.$transaction(async (tx) => {
      const invitation = await invitationRepository.getPendingInvitationById(
        invitationId,
        tx,
      );
      if (!invitation) {
        actionError = {
          message: "Invitation not found",
          code: InvitationErrorCode.INVITATION_NOT_FOUND,
        };
        throw new Error("Invitation not found");
      }
      const { organizationId, inviterId } = invitation;

      // check inviter member
      const inviterMember =
        await memberRepository.getMemberByUserIdAndOrganizationId(
          inviterId,
          organizationId,
          tx,
        );
      if (!inviterMember) {
        actionError = {
          message: "Inviter member not found",
          code: InvitationErrorCode.INVITER_NOT_FOUND,
        };
        throw new Error("Inviter member not found");
      }

      // reject invitation by invitation id
      await invitationRepository.rejectPendingInvitationById(invitationId, tx);
    });

    return Ok();
  } catch (error) {
    console.error("Failed to reject invitation", error);
    return Err(actionError);
  }
}
