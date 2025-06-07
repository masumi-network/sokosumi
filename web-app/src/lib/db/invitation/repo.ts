"use server";

import { prisma } from "@/lib/db";
import { Prisma } from "@/prisma/generated/client";

import { invitationInclude, InvitationWithRelations } from "./types";

export async function getInvitationWithRelationsById(
  id: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<InvitationWithRelations | null> {
  return await tx.invitation.findUnique({
    where: { id },
    include: invitationInclude,
  });
}
