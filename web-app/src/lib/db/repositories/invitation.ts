import "server-only";

import { invitationInclude, InvitationWithRelations } from "@/lib/db/types";
import { Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

export async function retrieveInvitationById(
  id: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<InvitationWithRelations | null> {
  return tx.invitation.findUnique({
    where: { id },
    include: invitationInclude,
  });
}

export async function acceptPendingInvitationsByEmailAndOrganizationId(
  email: string,
  organizationId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  return tx.invitation.updateMany({
    where: { email, organizationId, status: "pending" },
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
