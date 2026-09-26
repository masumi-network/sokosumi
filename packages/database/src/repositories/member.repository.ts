import type { Member, Prisma } from "../generated/prisma/client.js";
import { assertOrganizationRetainsOwner } from "../helpers/organization-owner.js";
import { ensureAssignedSeatsWithinCapacity } from "../helpers/organization-seats.js";
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

export const memberRepository = (() => {
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
   * `lastSeenAt` is the most recent `Session.updatedAt` per user, or null.
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

  /** Ordered by role, then user name, with member id as a stable cursor tiebreaker. */
  async function listMembersForAdminOverview(
    params: {
      organizationId: string;
      cursor?: string;
      take: number;
      skip?: number;
    },
    tx: Prisma.TransactionClient,
  ): Promise<{
    members: MemberWithUserAndLastSeen[];
    total: number;
  }> {
    const where = { organizationId: params.organizationId };

    const [members, total] = await Promise.all([
      tx.member.findMany({
        where,
        include: memberUserInclude,
        orderBy: [...memberOrderBy, { id: "asc" }],
        take: params.take,
        skip: params.skip,
        cursor: params.cursor ? { id: params.cursor } : undefined,
      }),
      tx.member.count({ where }),
    ]);

    const userIds = members.map((member) => member.userId);
    if (userIds.length === 0) {
      return { members: [], total };
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

    return {
      members: members.map((member) => ({
        ...member,
        lastSeenAt: lastSeenByUserId.get(member.userId) ?? null,
      })),
      total,
    };
  }

  return {
    assignSeat,
    createMember,
    getAssignedMemberCount,
    getMemberByIdAndOrganizationId,
    getMembersWithOrganizationByUserId,
    getMembersOrganizationIdsByUserId,
    getMemberByUserIdAndOrganizationId,
    getMembersWithUserAndLastSeen,
    getMembersByOrganizationId,
    listMembersForAdminOverview,
    removeMember,
    unassignSeat,
    updateMemberRole,
  };
})();
