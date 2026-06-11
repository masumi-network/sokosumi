import type { Invitation, Prisma } from "../generated/prisma/client.js";
import {
  InvitationStatus,
  type InvitationWithRelations,
  invitationInclude,
} from "../types/invitation.js";

/**
 * Repository for managing invitation records in the database.
 * Provides methods for querying, accepting, and rejecting invitations.
 */
export const invitationRepository = {
  /**
   * Retrieves a pending invitation by its ID, regardless of expiration.
   *
   * @param id - The invitation ID.
   * @param tx - Optional Prisma transaction client.
   * @returns Promise resolving to the invitation with relations, or null if not found.
   */
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
