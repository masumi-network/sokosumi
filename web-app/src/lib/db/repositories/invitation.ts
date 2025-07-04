import "server-only";

import {
  invitationInclude,
  InvitationStatus,
  InvitationWithRelations,
} from "@/lib/db/types";
import { Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

export async function retrievePendingInvitationById(
  id: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<InvitationWithRelations | null> {
  return tx.invitation.findUnique({
    where: { id, status: InvitationStatus.PENDING },
    include: invitationInclude,
  });
}

export async function retrieveValidPendingInvitationById(
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
}

export async function acceptValidPendingInvitationById(
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
}

export async function rejectValidPendingInvitationById(
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
}

export async function retrievePendingInvitationsByOrganizationId(
  organizationId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  return tx.invitation.findMany({
    where: { organizationId, status: InvitationStatus.PENDING },
  });
}

export async function retrieveValidPendingInvitationsByEmail(
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
}
