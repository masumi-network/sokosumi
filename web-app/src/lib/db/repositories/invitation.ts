import "server-only";

import { invitationInclude, InvitationWithRelations } from "@/lib/db/types";
import { Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

export async function retrievePendingInvitationById(
  id: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<InvitationWithRelations | null> {
  return tx.invitation.findUnique({
    where: { id, status: "pending" },
    include: invitationInclude,
  });
}

export async function acceptValidPendingInvitationsByEmailAndOrganizationId(
  email: string,
  organizationId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  return tx.invitation.updateMany({
    where: {
      email,
      organizationId,
      status: "pending",
      expiresAt: {
        gt: new Date(),
      },
    },
    data: { status: "accepted" },
  });
}

export async function retrievePendingInvitationsByOrganizationId(
  organizationId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  return tx.invitation.findMany({
    where: { organizationId, status: "pending" },
  });
}

export async function retrieveValidPendingInvitationsByEmail(
  email: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<InvitationWithRelations[]> {
  return tx.invitation.findMany({
    where: {
      email,
      status: "pending",
      expiresAt: {
        gt: new Date(),
      },
    },
    include: invitationInclude,
  });
}
