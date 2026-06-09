import "server-only";

import type { Prisma } from "@sokosumi/database";
import {
  ensureLocalFreeSubscriptionPeriod,
  FREE_SUBSCRIPTION_PLAN,
  fetchOrganizationMemberUserIds,
  getUnusedSeatCount,
  grantFreeOrganizationMemberSubscriptionCredits,
  isActiveSubscriptionStatus,
  resolveOrganizationBillingPlan,
  resolvePurchasedSeats,
} from "@sokosumi/database/helpers";
import {
  memberRepository,
  subscriptionRepository,
} from "@sokosumi/database/repositories";
import type { OrganizationBillingPlanName } from "@sokosumi/utils";
import { APIError } from "better-auth/api";

import prisma from "@/lib/db/prisma";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import { grantUnusedSeatSubscriptionCreditsIfEligible } from "@/lib/services/organization-seat-credits.service";

export interface OrganizationSeatSummary {
  assignedCount: number;
  memberCount: number;
  isEnterpriseContract: boolean;
  paidPlan: OrganizationBillingPlanName | null;
  purchasedSeats: number;
  unusedSeats: number;
}

function resolveOrganizationPaidPlanLabel(
  plan: OrganizationBillingPlanName,
): OrganizationBillingPlanName | null {
  if (plan === "free") {
    return null;
  }

  return plan;
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

  if (!member || !isOrganizationOwnerOrAdmin(member.role)) {
    throw new APIError("FORBIDDEN", {
      message:
        "Only organization owners and admins can manage seat assignments",
    });
  }
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

async function syncLocalFreeOrganizationCreditsIfNeeded(
  organizationId: string,
  subscription: {
    createdAt: Date;
    periodEnd: Date;
    periodStart: Date;
    seats: number | null;
    status: string;
    stripeSubscriptionId: string | null;
  },
  tx: Prisma.TransactionClient,
): Promise<void> {
  if (
    subscription.stripeSubscriptionId ||
    !isActiveSubscriptionStatus(subscription.status)
  ) {
    return;
  }

  const memberUserIds = await fetchOrganizationMemberUserIds(
    organizationId,
    tx,
  );

  await ensureLocalFreeSubscriptionPeriod(
    {
      billingAnchorDate: subscription.createdAt,
      memberUserIds,
      organizationId,
      periodEnd: subscription.periodEnd,
      periodStart: subscription.periodStart,
      purchasedSeats: resolvePurchasedSeats(subscription.seats),
      referenceId: organizationId,
    },
    tx,
  );
}

export const organizationSeatService = (() => {
  return {
    async getSeatSummary(
      organizationId: string,
    ): Promise<OrganizationSeatSummary> {
      const [assignedCount, memberCount, billingPlan] = await Promise.all([
        memberRepository.getAssignedMemberCount(organizationId, prisma),
        prisma.member.count({
          where: {
            organizationId,
          },
        }),
        resolveOrganizationBillingPlan(organizationId, prisma),
      ]);
      const paidPlan = resolveOrganizationPaidPlanLabel(billingPlan.plan);
      const purchasedSeats = billingPlan.purchasedSeats;
      const hasSeatEntitlements = paidPlan != null;

      return {
        assignedCount: hasSeatEntitlements ? assignedCount : 0,
        memberCount,
        isEnterpriseContract: billingPlan.mode === "enterprise_contract",
        paidPlan,
        purchasedSeats,
        unusedSeats: hasSeatEntitlements
          ? getUnusedSeatCount(purchasedSeats, assignedCount)
          : 0,
      };
    },

    async assignSeat(
      userId: string,
      organizationId: string,
      memberId: string,
    ): Promise<{ memberId: string; seatAssignedAt: Date }> {
      await ensureCanManageSeatAssignments(userId, organizationId);

      try {
        return await prisma.$transaction(async (tx) => {
          const billingPlan = await resolveOrganizationBillingPlan(
            organizationId,
            tx,
          );
          const purchasedSeats = billingPlan.purchasedSeats;
          const subscription =
            billingPlan.mode === "self_serve"
              ? await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
                  organizationId,
                  tx,
                )
              : null;

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

          const suppressSelfServeSeatCredits =
            billingPlan.mode === "enterprise_contract" &&
            billingPlan.isConsumable;

          if (!suppressSelfServeSeatCredits) {
            await grantUnusedSeatSubscriptionCreditsIfEligible(
              organizationId,
              member.userId,
              tx,
            );
          }

          if (
            billingPlan.mode === "self_serve" &&
            subscription?.periodStart &&
            subscription?.periodEnd
          ) {
            await syncLocalFreeOrganizationCreditsIfNeeded(
              organizationId,
              {
                createdAt: subscription.createdAt,
                periodEnd: subscription.periodEnd,
                periodStart: subscription.periodStart,
                seats: subscription.seats,
                status: subscription.status,
                stripeSubscriptionId: subscription.stripeSubscriptionId,
              },
              tx,
            );
          }

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
          const billingPlan = await resolveOrganizationBillingPlan(
            organizationId,
            tx,
          );
          const member = await memberRepository.unassignSeat(
            memberId,
            organizationId,
            tx,
          );

          if (
            billingPlan.mode === "enterprise_contract" &&
            billingPlan.isConsumable
          ) {
            return {
              memberId: member.id,
            };
          }

          const subscription =
            await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
              organizationId,
              tx,
            );

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
          } else if (subscription?.periodStart && subscription.periodEnd) {
            await syncLocalFreeOrganizationCreditsIfNeeded(
              organizationId,
              {
                createdAt: subscription.createdAt,
                periodEnd: subscription.periodEnd,
                periodStart: subscription.periodStart,
                seats: subscription.seats,
                status: subscription.status,
                stripeSubscriptionId: subscription.stripeSubscriptionId,
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
