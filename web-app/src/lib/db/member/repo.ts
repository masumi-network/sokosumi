"use server";

import { prisma } from "@/lib/db";
import { Member, Prisma, Role } from "@/prisma/generated/client";

export async function getOrganizationMembers(
  organizationId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Member[]> {
  return await tx.member.findMany({
    where: {
      organizationId,
    },
  });
}

export async function createMember(
  userId: string,
  organizationId: string,
  role: Role,
  tx: Prisma.TransactionClient = prisma,
): Promise<Member> {
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
      role,
    },
  });
}
