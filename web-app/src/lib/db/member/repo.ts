"use server";

import { MemberRole, prisma } from "@/lib/db";
import { Member, Prisma } from "@/prisma/generated/client";

import {
  memberOrderBy,
  memberOrganizationInclude,
  memberRoleOrderBy,
  memberUserInclude,
  MemberWithOrganization,
  MemberWithUser,
} from "./types";

export async function getMembersByOrganizationId(
  organizationId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Member[]> {
  return await tx.member.findMany({
    where: {
      organizationId,
    },
  });
}

export async function getMembersWithUser(
  where: Prisma.MemberWhereInput,
  params: {
    page: number;
    limit: number;
  } = {
    page: 1,
    limit: 10,
  },
  tx: Prisma.TransactionClient = prisma,
): Promise<MemberWithUser[]> {
  return await tx.member.findMany({
    where,
    include: memberUserInclude,
    orderBy: [...memberOrderBy],
    skip: (params.page - 1) * params.limit,
    take: params.limit,
  });
}

export async function getMemberByUserIdAndOrganizationId(
  userId: string,
  organizationId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Member | null> {
  return await tx.member.findUnique({
    where: {
      userId_organizationId: {
        userId,
        organizationId,
      },
    },
  });
}

export async function getMembersWithOrganizationByUserId(
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

export async function updateRole(
  memberId: string,
  role: MemberRole,
  tx: Prisma.TransactionClient = prisma,
) {
  return await tx.member.update({
    where: { id: memberId },
    data: { role },
  });
}
