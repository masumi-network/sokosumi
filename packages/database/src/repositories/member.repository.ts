import type { Member, Prisma } from "../generated/prisma/client.js";
import { assertOrganizationRetainsOwner } from "../helpers/organization-owner.js";
import {
  ensureAssignedSeatsWithinCapacity,
  getSortedUniqueUserIds,
} from "../helpers/organization-seats.js";
import { fetchOrganizationMemberUserIds } from "../helpers/organization-subscription-credit-audience.js";
import {
  type MemberWithOrganization,
  type MemberWithUser,
  type MemberWithUserAndLastSeen,
  memberOrderBy,
  memberOrganizationInclude,
  memberRoleOrderBy,
  memberUserInclude,
} from "../types/member.js";
import { MemberRole } from "../types/organization.js";

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
    tx: Prisma.TransactionClient,
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
    tx: Prisma.TransactionClient,
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
    tx: Prisma.TransactionClient,
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
    tx: Prisma.TransactionClient,
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
    tx: Prisma.TransactionClient,
  ): Promise<MemberWithUser[]> {
    return await tx.member.findMany({
      where,
      include: memberUserInclude,
      orderBy: [...memberOrderBy],
    });
  }

  /**
   * Retrieves all members of an organization, including user details and a
   * session-derived `lastSeenAt` timestamp (the most recent
   * `Session.updatedAt` per user, or `null` if the user has no sessions).
   *
   * @param organizationId - The ID of the organization.
   * @param tx - Prisma transaction client.
   * @returns An array of MemberWithUserAndLastSeen objects.
   */
  async function getMembersWithUserAndLastSeen(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<MemberWithUserAndLastSeen[]> {
    const members = await getMembersWithUser({ organizationId }, tx);

    const userIds = members.map((member) => member.userId);
    if (userIds.length === 0) {
      return [];
    }

    const lastSessionByUser = await tx.session.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds } },
      _max: { updatedAt: true },
    });

    const lastSeenByUserId = new Map<string, Date>(
      lastSessionByUser.flatMap((group) =>
        group._max.updatedAt ? [[group.userId, group._max.updatedAt]] : [],
      ),
    );

    return members.map((member) => ({
      ...member,
      lastSeenAt: lastSeenByUserId.get(member.userId) ?? null,
    }));
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
    tx: Prisma.TransactionClient,
  ): Promise<Member[]> {
    return await tx.member.findMany({
      where: {
        organizationId,
      },
    });
  }

  async function getAssignedMemberCount(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    return await tx.member.count({
      where: {
        organizationId,
        seatAssignedAt: {
          not: null,
        },
      },
    });
  }

  async function getAssignedMemberUserIds(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string[]> {
    const members = await tx.member.findMany({
      where: {
        organizationId,
        seatAssignedAt: {
          not: null,
        },
      },
      select: {
        userId: true,
      },
      orderBy: [{ userId: "asc" }],
    });

    return getSortedUniqueUserIds(members.map((member) => member.userId));
  }

  async function getOrganizationMemberUserIds(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string[]> {
    return fetchOrganizationMemberUserIds(organizationId, tx);
  }

  async function getUnassignedMemberUserIds(
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string[]> {
    const members = await tx.member.findMany({
      where: {
        organizationId,
        seatAssignedAt: null,
      },
      select: {
        userId: true,
      },
      orderBy: [{ userId: "asc" }],
    });

    return getSortedUniqueUserIds(members.map((member) => member.userId));
  }

  async function getMemberByIdAndOrganizationId(
    memberId: string,
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Member | null> {
    return await tx.member.findFirst({
      where: {
        id: memberId,
        organizationId,
      },
    });
  }

  async function assignSeat(
    memberId: string,
    organizationId: string,
    purchasedSeats: number,
    tx: Prisma.TransactionClient,
  ): Promise<Member> {
    const member = await getMemberByIdAndOrganizationId(
      memberId,
      organizationId,
      tx,
    );
    if (!member) {
      throw new Error("Member not found");
    }

    if (member.seatAssignedAt) {
      return member;
    }

    const assignedCount = await getAssignedMemberCount(organizationId, tx);
    ensureAssignedSeatsWithinCapacity(assignedCount + 1, purchasedSeats);

    return await tx.member.update({
      where: {
        id: memberId,
      },
      data: {
        seatAssignedAt: new Date(),
      },
    });
  }

  async function updateMemberRole(
    memberId: string,
    organizationId: string,
    role: MemberRole,
    tx: Prisma.TransactionClient,
  ): Promise<Member> {
    await assertOrganizationRetainsOwner(organizationId, memberId, role, tx);

    return await tx.member.update({
      where: {
        id: memberId,
      },
      data: {
        role,
      },
    });
  }

  async function removeMember(
    memberId: string,
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await assertOrganizationRetainsOwner(organizationId, memberId, null, tx);

    await tx.member.delete({
      where: {
        id: memberId,
      },
    });
  }

  async function unassignSeat(
    memberId: string,
    organizationId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Member> {
    const member = await getMemberByIdAndOrganizationId(
      memberId,
      organizationId,
      tx,
    );
    if (!member) {
      throw new Error("Member not found");
    }

    if (!member.seatAssignedAt) {
      return member;
    }

    return await tx.member.update({
      where: {
        id: memberId,
      },
      data: {
        seatAssignedAt: null,
      },
    });
  }

  return {
    assignSeat,
    createMember,
    getAssignedMemberCount,
    getAssignedMemberUserIds,
    getOrganizationMemberUserIds,
    getUnassignedMemberUserIds,
    getMemberByIdAndOrganizationId,
    getMembersWithOrganizationByUserId,
    getMembersOrganizationIdsByUserId,
    getMemberByUserIdAndOrganizationId,
    getMembersWithUser,
    getMembersWithUserAndLastSeen,
    getMembersByOrganizationId,
    removeMember,
    unassignSeat,
    updateMemberRole,
  };
})();
