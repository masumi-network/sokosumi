import { getSession } from "src/lib/auth/utils";

import { MemberRole } from "@/lib/db";
import {
  memberOrderBy,
  memberOrganizationInclude,
  memberRoleOrderBy,
  memberUserInclude,
  MemberWithOrganization,
  MemberWithUser,
} from "@/lib/db/types/member";
import { Member, Prisma } from "@/prisma/generated/client";

import { BaseService } from "./base.service";

export class MemberService extends BaseService<MemberService> {
  async getMemberById(id: string): Promise<Member | null> {
    return this.client.member.findUnique({ where: { id } });
  }

  async getMembersByOrganizationId(organizationId: string): Promise<Member[]> {
    return this.client.member.findMany({ where: { organizationId } });
  }

  async getMembersWithUser(
    where: Prisma.MemberWhereInput,
    params: {
      page: number;
      limit: number;
    } = {
      page: 1,
      limit: 10,
    },
  ): Promise<MemberWithUser[]> {
    return this.client.member.findMany({
      where,
      include: memberUserInclude,
      orderBy: [...memberOrderBy],
      skip: (params.page - 1) * params.limit,
      take: params.limit,
    });
  }

  async getMemberByUserIdAndOrganizationId(
    userId: string,
    organizationId: string,
  ): Promise<Member | null> {
    return this.client.member.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
  }

  async getMembersOrganizationIdsByUserId(userId: string): Promise<string[]> {
    const userMemberships = await this.client.member.findMany({
      where: { userId },
      select: { organizationId: true },
    });
    return userMemberships.map((m) => m.organizationId);
  }

  async getMembersWithOrganizationByUserId(
    userId: string,
  ): Promise<MemberWithOrganization[]> {
    return this.client.member.findMany({
      where: { userId },
      include: memberOrganizationInclude,
      orderBy: [{ ...memberRoleOrderBy }],
    });
  }

  async createMember(
    userId: string,
    organizationId: string,
    role: MemberRole,
  ): Promise<Member> {
    return this.client.member.create({
      data: {
        user: {
          connect: { id: userId },
        },
        organization: { connect: { id: organizationId } },
        role,
      },
    });
  }

  async updateMemberRole(memberId: string, role: MemberRole): Promise<Member> {
    return this.client.member.update({
      where: { id: memberId },
      data: { role },
    });
  }

  async getMyMembers(): Promise<MemberWithOrganization[] | null> {
    const session = await getSession();
    if (!session) {
      return null;
    }
    const userId = session.user.id;

    return this.getMembersWithOrganizationByUserId(userId);
  }
}
