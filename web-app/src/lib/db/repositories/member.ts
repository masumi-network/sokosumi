import "server-only";

import {
  memberOrganizationInclude,
  MemberRole,
  memberRoleOrderBy,
  MemberWithOrganization,
} from "@/lib/db/types";
import { Member, Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

export async function retrieveMembersWithOrganizationByUserId(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<MemberWithOrganization[]> {
  return await tx.member.findMany({
    where: {
      userId,
    },
    include: memberOrganizationInclude,
    orderBy: [{ ...memberRoleOrderBy }],
  });
}

export async function createMember(
  userId: string,
  organizationId: string,
  role: MemberRole,
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

export async function updateMemberRole(
  memberId: string,
  role: string,
  tx: Prisma.TransactionClient = prisma,
) {
  return await tx.member.update({
    where: { id: memberId },
    data: { role },
  });
}
