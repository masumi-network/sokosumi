"use server";

import { requireAuthentication } from "@/lib/auth/utils";
import { prisma } from "@/lib/db";
import { Member, Prisma, Role } from "@/prisma/generated/client";

import {
  memberOrderBy,
  memberOrganizationInclude,
  MemberWithOrganization,
} from "./types";

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

export async function listMembers(
  tx: Prisma.TransactionClient = prisma,
): Promise<MemberWithOrganization[]> {
  const { session } = await requireAuthentication();
  const userId = session.user.id;

  return await tx.member.findMany({
    where: {
      userId,
    },
    include: memberOrganizationInclude,
    orderBy: [...memberOrderBy],
  });
}

export async function deleteMember(
  userId: string,
  organizationId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  return await tx.member.deleteMany({
    where: {
      userId,
      organizationId,
    },
  });
}
