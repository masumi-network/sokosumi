import "server-only";

import prisma from "../client";
import type { Member, Prisma } from "../generated/prisma/client";
import {
  memberOrderBy,
  memberOrganizationInclude,
  memberRoleOrderBy,
  memberUserInclude,
  MemberWithOrganization,
  MemberWithUser,
} from "../types/member";
import { MemberRole } from "../types/organization";

/**
 * Repository for managing Member entities and related queries.
 * Provides methods for creating members, retrieving member lists,
 * and fetching membership information with related user or organization data.
 */
export const memberRepository = (() => {
  /**
   * Creates a new member in the specified organization with the given role.
   *
   * @param userId - The ID of the user to add as a member.
   * @param organizationId - The ID of the organization.
   * @param role - The role to assign to the member (e.g., ADMIN, MEMBER).
   * @param tx - Optional Prisma transaction client for transactional operations.
   * @returns The created Member object.
   */
  async function createMember(
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

  /**
   * Retrieves all memberships for a user, including organization details.
   *
   * @param userId - The ID of the user.
   * @param tx - Optional Prisma transaction client.
   * @returns An array of MemberWithOrganization objects.
   */
  async function getMembersWithOrganizationByUserId(
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

  /**
   * Retrieves all organization IDs for which the user is a member.
   *
   * @param userId - The ID of the user.
   * @param tx - Optional Prisma transaction client.
   * @returns An array of organization IDs.
   */
  async function getMembersOrganizationIdsByUserId(
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<string[]> {
    const userMemberships = await tx.member.findMany({
      where: { userId },
      select: { organizationId: true },
    });
    return userMemberships.map((m) => m.organizationId);
  }

  /**
   * Retrieves a member by user ID and organization ID.
   *
   * @param userId - The ID of the user.
   * @param organizationId - The ID of the organization.
   * @param tx - Optional Prisma transaction client.
   * @returns The Member object if found, otherwise null.
   */
  async function getMemberByUserIdAndOrganizationId(
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

  /**
   * Retrieves members matching the given filter, including user details.
   * Supports pagination.
   *
   * @param where - Prisma filter for members.
   * @param tx - Optional Prisma transaction client.
   * @returns An array of MemberWithUser objects.
   */
  async function getMembersWithUser(
    where: Prisma.MemberWhereInput,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<MemberWithUser[]> {
    return await tx.member.findMany({
      where,
      include: memberUserInclude,
      orderBy: [...memberOrderBy],
    });
  }

  /**
   * Retrieves all members of a given organization.
   *
   * @param organizationId - The ID of the organization.
   * @param tx - Optional Prisma transaction client.
   * @returns An array of Member objects.
   */
  async function getMembersByOrganizationId(
    organizationId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Member[]> {
    return await tx.member.findMany({
      where: {
        organizationId,
      },
    });
  }

  /**
   * Retrieves the count of members by role for a given organization.
   *
   * @param organizationId - The ID of the organization.
   * @param tx - Optional Prisma transaction client.
   * @returns An object with the count of members by role.
   */
  async function getPerRoleCountByOrganizationId(
    organizationId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<{ [key in MemberRole]: number }> {
    const memberCounts = await tx.member.groupBy({
      by: ["role"],
      where: { organizationId },
      _count: {
        role: true,
      },
    });

    const counts: { [key in MemberRole]: number } = Object.values(
      MemberRole,
    ).reduce(
      (acc, role) => {
        acc[role] = 0;
        return acc;
      },
      {} as { [key in MemberRole]: number },
    );

    memberCounts.forEach((group) => {
      const {
        role,
        _count: { role: roleCount },
      } = group;
      if (role in counts) {
        counts[role as MemberRole] = roleCount;
      }
    });

    return counts;
  }

  return {
    createMember,
    getMembersWithOrganizationByUserId,
    getMembersOrganizationIdsByUserId,
    getMemberByUserIdAndOrganizationId,
    getMembersWithUser,
    getMembersByOrganizationId,
    getPerRoleCountByOrganizationId,
  };
})();
