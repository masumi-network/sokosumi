import "server-only";

import { MemberRole } from "@sokosumi/database";
import {
  FREE_SUBSCRIPTION_PLAN,
  getUnusedSeatCount,
  grantFreeOrganizationMemberSubscriptionCredits,
  isActiveSubscriptionStatus,
  resolvePurchasedSeats,
} from "@sokosumi/database/helpers";
import {
  memberRepository,
  subscriptionRepository,
} from "@sokosumi/database/repositories";
import { APIError } from "better-auth/api";

import { parsePlanName } from "@/components/billing/subscription-plan-utils";
import prisma from "@/lib/db/prisma";
import { grantUnusedSeatSubscriptionCreditsIfEligible } from "@/lib/services/organization-seat-credits.service";
import type { SubscriptionPlanName } from "@/lib/stripe/subscription-catalog";

export interface OrganizationSeatSummary {
  assignedCount: number;
  memberCount: number;
  paidPlan: SubscriptionPlanName | null;
  purchasedSeats: number;
  unusedSeats: number;
}

function resolveOrganizationPaidPlan(
  subscription: {
    plan: string;
    status: string;
  } | null,
): SubscriptionPlanName | null {
  if (!subscription || !isActiveSubscriptionStatus(subscription.status)) {
    return null;
  }

  const parsedPlan = parsePlanName(subscription.plan);
  if (!parsedPlan || parsedPlan === "free") {
    return null;
  }

  return parsedPlan;
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
      const [assignedCount, memberCount, subscription] = await Promise.all([
        memberRepository.getAssignedMemberCount(organizationId, prisma),
        prisma.member.count({
          where: {
            organizationId,
          },
        }),
        subscriptionRepository.getLatestActiveSubscriptionByReferenceId(
          organizationId,
          prisma,
        ),
      ]);
      const purchasedSeats = resolvePurchasedSeats(subscription?.seats);

      return {
        assignedCount,
        memberCount,
        paidPlan: resolveOrganizationPaidPlan(subscription),
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
        return await prisma.$transaction(async (tx) => {
          const member = await memberRepository.assignSeat(
            memberId,
            organizationId,
            purchasedSeats,
            tx,
          );

          if (!member.seatAssignedAt) {
            throw new APIError("INTERNAL_SERVER_ERROR", {
              message: "Failed to assign seat",
            });
          }

          await grantUnusedSeatSubscriptionCreditsIfEligible(
            organizationId,
            member.userId,
            tx,
          );

          return {
            memberId: member.id,
            seatAssignedAt: member.seatAssignedAt,
          };
        });
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
        return await prisma.$transaction(async (tx) => {
          const member = await memberRepository.unassignSeat(
            memberId,
            organizationId,
            tx,
          );

          const subscription =
            await subscriptionRepository.getLatestActiveSubscriptionByReferenceId(
              organizationId,
              tx,
            );

          // Paid (Stripe-backed) organization: the member loses paid seat
          // credits going forward and joins the free monthly tier for the
          // current period.
          if (
            subscription?.stripeSubscriptionId &&
            subscription.periodEnd &&
            subscription.plan !== FREE_SUBSCRIPTION_PLAN &&
            isActiveSubscriptionStatus(subscription.status)
          ) {
            await grantFreeOrganizationMemberSubscriptionCredits(
              {
                memberUserIds: [member.userId],
                organizationId,
                periodEnd: subscription.periodEnd,
              },
              tx,
            );
          }

          return {
            memberId: member.id,
          };
        });
      } catch (error) {
        mapSeatRepositoryError(error);
      }
    },
  };
})();
