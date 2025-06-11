"use server";

import { prisma } from "@/lib/db";
import { Prisma } from "@/prisma/generated/client";

import { invitationInclude, InvitationWithRelations } from "./types";

export async function getInvitationById(
  id: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<InvitationWithRelations | null> {
  return tx.invitation.findUnique({
    where: { id },
    include: invitationInclude,
  });
}
