import prisma from "../client";
import type { Prisma } from "../generated/prisma/client";
import {
  invitationInclude,
  InvitationStatus,
  InvitationWithRelations,
} from "../types/invitation";

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
    tx: Prisma.TransactionClient = prisma,
  ): Promise<InvitationWithRelations | null> {
    return tx.invitation.findUnique({
      where: { id, status: InvitationStatus.PENDING },
      include: invitationInclude,
    });
  },

  /**
   * Retrieves all valid (not expired) pending invitations for a given email.
   *
   * @param email - The email address to search invitations for.
   * @param tx - Optional Prisma transaction client.
   * @returns Promise resolving to an array of InvitationWithRelations.
   */
  async getValidPendingInvitationsByEmail(
    email: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<InvitationWithRelations[]> {
    return tx.invitation.findMany({
      where: {
        email,
        status: InvitationStatus.PENDING,
        expiresAt: {
          gt: new Date(),
        },
      },
      include: invitationInclude,
    });
  },

  /**
   * Checks if there is at least one pending invitation for a given email.
   *
   * @param email - The email address to search invitations for.
   * @param tx - Optional Prisma transaction client.
   * @returns Promise resolving to true if there is at least one pending invitation for the given email, false otherwise.
   */
  async hasPendingInvitationByEmail(
    email: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<boolean> {
    const count = await tx.invitation.count({
      where: {
        email,
        status: InvitationStatus.PENDING,
      },
      take: 1,
    });
    return count > 0;
  },
};
