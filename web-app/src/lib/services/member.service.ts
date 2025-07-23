import { getSession } from "@/lib/auth/utils";
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

/**
 * Service for managing organization members.
 * Provides methods to retrieve, create, and update members and their roles,
 * as well as utility methods for working with the current user's memberships.
 */
export class MemberService extends BaseService<MemberService> {
  /**
   * Retrieves a member by their unique ID.
   * @param id - The member's unique identifier.
   * @returns The member if found, otherwise null.
   */
  async getMemberById(id: string): Promise<Member | null> {
    return this.client.member.findUnique({ where: { id } });
  }

  /**
   * Retrieves all members belonging to a specific organization.
   * @param organizationId - The organization's unique identifier.
   * @returns An array of members in the organization.
   */
  async getMembersByOrganizationId(organizationId: string): Promise<Member[]> {
    return this.client.member.findMany({ where: { organizationId } });
  }

  /**
   * Retrieves members with their associated user data, supporting pagination.
   * @param where - Prisma filter for members.
   * @param params - Pagination parameters (page, limit).
   * @returns An array of members with user information.
   */
  async getMembersWithUser(
    where: Prisma.MemberWhereInput,
    params: {
      page: number;
      limit: number;
    } = {
      page: 1,
      limit: 100,
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

  /**
   * Retrieves a member by user ID and organization ID.
   * @param userId - The user's unique identifier.
   * @param organizationId - The organization's unique identifier.
   * @returns The member if found, otherwise null.
   */
  async getMemberByUserIdAndOrganizationId(
    userId: string,
    organizationId: string,
  ): Promise<Member | null> {
    return this.client.member.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
  }

  /**
   * Retrieves all organization IDs for which the user is a member.
   * @param userId - The user's unique identifier.
   * @returns An array of organization IDs.
   */
  async getMembersOrganizationIdsByUserId(userId: string): Promise<string[]> {
    const userMemberships = await this.client.member.findMany({
      where: { userId },
      select: { organizationId: true },
    });
    return userMemberships.map((m) => m.organizationId);
  }

  /**
   * Retrieves all memberships for a user, including organization data.
   * @param userId - The user's unique identifier.
   * @returns An array of member records with organization information.
   */
  async getMembersWithOrganizationByUserId(
    userId: string,
  ): Promise<MemberWithOrganization[]> {
    return this.client.member.findMany({
      where: { userId },
      include: memberOrganizationInclude,
      orderBy: [{ ...memberRoleOrderBy }],
    });
  }

  /**
   * Creates a new member in an organization with a specific role.
   * @param userId - The user's unique identifier.
   * @param organizationId - The organization's unique identifier.
   * @param role - The role to assign to the member.
   * @returns The created member.
   */
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

  /**
   * Updates the role of a member.
   * @param memberId - The member's unique identifier.
   * @param role - The new role to assign.
   * @returns The updated member.
   */
  async updateMemberRole(memberId: string, role: MemberRole): Promise<Member> {
    return this.client.member.update({
      where: { id: memberId },
      data: { role },
    });
  }

  /**
   * Retrieves all memberships for the currently authenticated user,
   * including organization data.
   * @returns An array of member records with organization information, or null if not authenticated.
   */
  async getMyMembers(): Promise<MemberWithOrganization[] | null> {
    const session = await getSession();
    if (!session) {
      return null;
    }
    const userId = session.user.id;

    return this.getMembersWithOrganizationByUserId(userId);
  }

  /**
   * Retrieves the current user's member record in a specific organization.
   * @param organizationId - The organization's unique identifier.
   * @returns The member record if found, otherwise null.
   */
  async getMyMemberInOrganization(
    organizationId: string,
  ): Promise<Member | null> {
    const session = await getSession();
    if (!session) {
      return null;
    }
    const userId = session.user.id;

    return this.getMemberByUserIdAndOrganizationId(userId, organizationId);
  }
}
