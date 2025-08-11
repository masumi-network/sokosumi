import "server-only";

import {
  invitationInclude,
  InvitationStatus,
  InvitationWithRelations,
} from "@/lib/db/types";
import { Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

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
   * Retrieves a valid (not expired) pending invitation by its ID.
   *
   * @param id - The invitation ID.
   * @param tx - Optional Prisma transaction client.
   * @returns Promise resolving to the invitation with relations, or null if not found.
   */
  async getValidPendingInvitationById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<InvitationWithRelations | null> {
    return tx.invitation.findUnique({
      where: {
        id,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
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
   * Retrieves the latest pending invitation per user for a specific organization.
   * This ensures only one invitation per email address is returned, even if multiple
   * expired invitations exist for the same user.
   *
   * @param organizationId - The ID of the organization.
   * @param tx - Optional Prisma transaction client.
   * @returns Promise resolving to an array of invitations with one per user.
   */
  async getPendingInvitationsByOrganizationId(
    organizationId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<InvitationWithRelations[]> {
    // Get all pending invitations for the organization
    const allInvitations = await tx.invitation.findMany({
      where: { organizationId, status: InvitationStatus.PENDING },
      include: invitationInclude,
      orderBy: { expiresAt: "desc" },
    });

    // Group by email and take the first (latest) invitation per email
    const emailMap = new Map<string, InvitationWithRelations>();
    for (const invitation of allInvitations) {
      if (!emailMap.has(invitation.email)) {
        emailMap.set(invitation.email, invitation);
      }
    }

    return Array.from(emailMap.values());
  },

  /**
   * Rejects a pending and valid (not expired) invitation by its ID.
   *
   * @param id - The invitation ID.
   * @param tx - Optional Prisma transaction client.
   * @returns Promise resolving to the updated invitation.
   */
  async rejectPendingInvitationById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return tx.invitation.update({
      where: {
        id,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      data: { status: InvitationStatus.REJECTED },
    });
  },

  /**
   * Accepts a pending and valid (not expired) invitation by its ID.
   *
   * @param id - The invitation ID.
   * @param tx - Optional Prisma transaction client.
   * @returns Promise resolving to the updated invitation.
   */
  async acceptPendingInvitationById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return tx.invitation.update({
      where: {
        id,
        status: InvitationStatus.PENDING,
        expiresAt: { gt: new Date() },
      },
      data: { status: InvitationStatus.ACCEPTED },
    });
  },
};
