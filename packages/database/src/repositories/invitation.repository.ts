import type { Invitation, Prisma } from "../generated/prisma/client.js";
import {
  InvitationStatus,
  type InvitationWithRelations,
  invitationInclude,
} from "../types/invitation.js";

export const invitationRepository = {
  /** Pending by id, regardless of expiration. */
  async getPendingInvitationById(
    id: string,
    tx: Prisma.TransactionClient,
  ): Promise<InvitationWithRelations | null> {
    return tx.invitation.findUnique({
      where: { id, status: InvitationStatus.PENDING },
      include: invitationInclude,
    });
  },

  async getPendingInvitationsByOrganizationId(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Invitation[]> {
    return tx.invitation.findMany({
      where: { organizationId, status: InvitationStatus.PENDING },
      orderBy: { expiresAt: "desc" },
    });
  },
};
