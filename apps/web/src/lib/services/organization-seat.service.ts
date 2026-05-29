import "server-only";

import { MemberRole } from "@sokosumi/database";
import {
  getUnusedSeatCount,
  resolvePurchasedSeats,
} from "@sokosumi/database/helpers";
import {
  memberRepository,
  subscriptionRepository,
} from "@sokosumi/database/repositories";
import { APIError } from "better-auth/api";

import prisma from "@/lib/db/prisma";

export interface OrganizationSeatSummary {
  assignedCount: number;
  memberCount: number;
  purchasedSeats: number;
  unusedSeats: number;
}

function isOwnerOrAdmin(role: string): boolean {
  return role === MemberRole.OWNER || role === MemberRole.ADMIN;
}

async function ensureCanManageSeatAssignments(
  userId: string,
  organizationId: string,
): Promise<void> {
  const member = await memberRepository.getMemberByUserIdAndOrganizationId(
    userId,
    organizationId,
    prisma,
  );

  if (!member || !isOwnerOrAdmin(member.role)) {
    throw new APIError("FORBIDDEN", {
      message:
        "Only organization owners and admins can manage seat assignments",
    });
  }
}

async function getPurchasedSeatsForOrganization(
  organizationId: string,
): Promise<number> {
  const subscription =
    await subscriptionRepository.getLatestActiveSubscriptionByReferenceId(
      organizationId,
      prisma,
    );

  return resolvePurchasedSeats(subscription?.seats);
}

function mapSeatRepositoryError(error: unknown): never {
  if (!(error instanceof Error)) {
    throw error;
  }

  if (error.message === "Member not found") {
    throw new APIError("NOT_FOUND", {
      message: "Member not found",
    });
  }

  if (error.message.includes("exceeds purchased seats")) {
    throw new APIError("BAD_REQUEST", {
      message:
        "No unused seats available. Purchase more seats or unassign another member.",
    });
  }

  throw error;
}

export const organizationSeatService = (() => {
  return {
    async getSeatSummary(
      organizationId: string,
    ): Promise<OrganizationSeatSummary> {
      const [assignedCount, memberCount, purchasedSeats] = await Promise.all([
        memberRepository.getAssignedMemberCount(organizationId, prisma),
        prisma.member.count({
          where: {
            organizationId,
          },
        }),
        getPurchasedSeatsForOrganization(organizationId),
      ]);

      return {
        assignedCount,
        memberCount,
        purchasedSeats,
        unusedSeats: getUnusedSeatCount(purchasedSeats, assignedCount),
      };
    },

    async assignSeat(
      userId: string,
      organizationId: string,
      memberId: string,
    ): Promise<{ memberId: string; seatAssignedAt: Date }> {
      await ensureCanManageSeatAssignments(userId, organizationId);
      const purchasedSeats =
        await getPurchasedSeatsForOrganization(organizationId);

      try {
        const member = await memberRepository.assignSeat(
          memberId,
          organizationId,
          purchasedSeats,
          prisma,
        );

        if (!member.seatAssignedAt) {
          throw new APIError("INTERNAL_SERVER_ERROR", {
            message: "Failed to assign seat",
          });
        }

        return {
          memberId: member.id,
          seatAssignedAt: member.seatAssignedAt,
        };
      } catch (error) {
        mapSeatRepositoryError(error);
      }
    },

    async unassignSeat(
      userId: string,
      organizationId: string,
      memberId: string,
    ): Promise<{ memberId: string }> {
      await ensureCanManageSeatAssignments(userId, organizationId);

      try {
        const member = await memberRepository.unassignSeat(
          memberId,
          organizationId,
          prisma,
        );

        return {
          memberId: member.id,
        };
      } catch (error) {
        mapSeatRepositoryError(error);
      }
    },
  };
})();
