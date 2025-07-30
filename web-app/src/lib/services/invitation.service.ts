import { getSessionOrThrow } from "@/lib/auth/utils";
import {
  InvitationErrorCode,
  invitationInclude,
  InvitationStatus,
  InvitationWithRelations,
} from "@/lib/db";
import { Invitation } from "@/prisma/generated/client";

import { BaseService } from "./base.service";
import { MemberService } from "./member.service";

export class InvitationService extends BaseService<InvitationService> {
  async getPendingInvitationById(
    id: string,
  ): Promise<InvitationWithRelations | null> {
    return this.client.invitation.findUnique({
      where: { id, status: InvitationStatus.PENDING },
      include: invitationInclude,
    });
  }

  async getPendingInvitations(organizationId: string): Promise<Invitation[]> {
    return await this.client.invitation.findMany({
      where: { organizationId, status: InvitationStatus.PENDING },
      include: invitationInclude,
    });
  }

  async getValidPendingInvitationById(
    id: string,
  ): Promise<InvitationWithRelations | null> {
    return this.client.invitation.findUnique({
      where: {
        id,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      include: invitationInclude,
    });
  }

  async acceptValidPendingInvitationById(id: string) {
    return this.client.invitation.update({
      where: {
        id,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      data: { status: InvitationStatus.ACCEPTED },
    });
  }

  async rejectValidPendingInvitationById(id: string) {
    return this.client.invitation.update({
      where: {
        id,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      data: { status: InvitationStatus.REJECTED },
    });
  }

  async getValidPendingInvitationsByEmail(
    email: string,
  ): Promise<InvitationWithRelations[]> {
    return this.client.invitation.findMany({
      where: {
        email,
        status: InvitationStatus.PENDING,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: invitationInclude,
    });
  }

  // Service methods

  async getPendingInvitation(id: string): Promise<
    | {
        error: InvitationErrorCode;
      }
    | {
        error?: never;
        invitation: InvitationWithRelations;
      }
  > {
    const invitation = await this.getPendingInvitationById(id);

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

    const inviterMember = await MemberService.getInstance(
      this.client,
    ).getMemberByUserIdAndOrganizationId(
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

  async getMyValidPendingInvitations(): Promise<InvitationWithRelations[]> {
    const session = await getSessionOrThrow();
    const userEmail = session.user.email;

    return await this.getValidPendingInvitationsByEmail(userEmail);
  }
}
