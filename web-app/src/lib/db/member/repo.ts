"use server";

import { prisma } from "@/lib/db";
import { Member, Prisma, Role } from "@/prisma/generated/client";

import {
  memberInclude,
  memberOrderBy,
  memberOrganizationInclude,
  memberUserInclude,
  MemberWithOrganization,
  MemberWithRelations,
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

export async function filterMembers(
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

export async function getMembersByUserId(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<MemberWithOrganization[]> {
  return await tx.member.findMany({
    where: {
      userId,
    },
    include: memberOrganizationInclude,
    orderBy: [...memberOrderBy],
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

export async function deleteMemberByUserIdAndOrganizationId(
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

export async function deleteMemberById(
  memberId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  return await tx.member.delete({
    where: { id: memberId },
  });
}

export async function getMemberWithRelationsById(
  memberId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<MemberWithRelations | null> {
  return await tx.member.findUnique({
    where: { id: memberId },
    include: memberInclude,
  });
}

export async function updateMemberRole(
  memberId: string,
  newRole: Role,
  tx: Prisma.TransactionClient = prisma,
) {
  return await tx.member.update({
    where: { id: memberId },
    data: { role: newRole },
  });
}
