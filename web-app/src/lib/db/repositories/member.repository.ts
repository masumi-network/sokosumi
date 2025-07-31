import "server-only";

import {
  memberOrderBy,
  memberOrganizationInclude,
  MemberRole,
  memberRoleOrderBy,
  memberUserInclude,
  MemberWithOrganization,
  MemberWithUser,
} from "@/lib/db/types";
import { Member, Prisma } from "@/prisma/generated/client";

import prisma from "./prisma";

/**
 * Repository for managing Member entities and related queries.
 * Provides methods for creating members, retrieving member lists,
 * and fetching membership information with related user or organization data.
 */
export const memberRepository = {
  /**
   * Creates a new member in the specified organization with the given role.
   *
   * @param userId - The ID of the user to add as a member.
   * @param organizationId - The ID of the organization.
   * @param role - The role to assign to the member (e.g., ADMIN, MEMBER).
   * @param tx - Optional Prisma transaction client for transactional operations.
   * @returns The created Member object.
   */
  async createMember(
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
  },

  /**
   * Retrieves all memberships for a user, including organization details.
   *
   * @param userId - The ID of the user.
   * @param tx - Optional Prisma transaction client.
   * @returns An array of MemberWithOrganization objects.
   */
  async getMembersWithOrganizationByUserId(
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
  },

  /**
   * Retrieves all organization IDs for which the user is a member.
   *
   * @param userId - The ID of the user.
   * @param tx - Optional Prisma transaction client.
   * @returns An array of organization IDs.
   */
  async getMembersOrganizationIdsByUserId(
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<string[]> {
    const userMemberships = await tx.member.findMany({
      where: { userId },
      select: { organizationId: true },
    });
    return userMemberships.map((m) => m.organizationId);
  },

  /**
   * Retrieves a member by user ID and organization ID.
   *
   * @param userId - The ID of the user.
   * @param organizationId - The ID of the organization.
   * @param tx - Optional Prisma transaction client.
   * @returns The Member object if found, otherwise null.
   */
  async getMemberByUserIdAndOrganizationId(
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
  },

  /**
   * Retrieves members matching the given filter, including user details.
   * Supports pagination.
   *
   * @param where - Prisma filter for members.
   * @param params - Pagination parameters (page, limit).
   * @param tx - Optional Prisma transaction client.
   * @returns An array of MemberWithUser objects.
   */
  async getMembersWithUser(
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
  },

  /**
   * Retrieves all members of a given organization.
   *
   * @param organizationId - The ID of the organization.
   * @param tx - Optional Prisma transaction client.
   * @returns An array of Member objects.
   */
  async getMembersByOrganizationId(
    organizationId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Member[]> {
    return await tx.member.findMany({
      where: {
        organizationId,
      },
    });
  },
};
