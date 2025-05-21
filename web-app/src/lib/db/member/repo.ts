import { prisma } from "@/lib/db";
import { Prisma } from "@/prisma/generated/client";

export async function connectUserToOrganization(
  userId: string,
  organizationId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  return await tx.member.create({
    data: {
      user: {
        connect: {
          id: userId,
        },
      },
      organization: {
        connect: {
          id: organizationId,
        },
      },
    },
  });
}
