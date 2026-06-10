import type { Prisma } from "@sokosumi/database";
import { MemberRole } from "@sokosumi/database";
import {
  ensureLocalFreeSubscriptionPeriod,
  FREE_SUBSCRIPTION_PLAN,
  fetchOrganizationMemberUserIds,
  grantFreeOrganizationMemberSubscriptionCredits,
  isActiveSubscriptionStatus,
  resolveOrganizationBillingPlan,
  resolvePurchasedSeats,
} from "@sokosumi/database/helpers";
import {
  memberRepository,
  subscriptionRepository,
} from "@sokosumi/database/repositories";

import {
  badRequest,
  forbidden,
  internalServerError,
  notFound,
} from "@/helpers/error";
import { grantUnusedSeatSubscriptionCreditsIfEligible } from "@/helpers/organization-seat-credits";
import prisma from "@/lib/db/prisma";

async function ensureCanManageSeatAssignments(
  userId: string,
  organizationId: string,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const member = await memberRepository.getMemberByUserIdAndOrganizationId(
    userId,
    organizationId,
    tx,
  );

  if (
    !member ||
    (member.role !== MemberRole.OWNER && member.role !== MemberRole.ADMIN)
  ) {
    forbidden(
      "Only organization owners and admins can manage seat assignments",
    );
  }
}

function mapSeatRepositoryError(error: unknown): never {
  if (!(error instanceof Error)) {
    throw error;
  }

  if (error.message === "Member not found") {
    notFound("Member not found");
  }

  if (error.message.includes("exceeds purchased seats")) {
    badRequest(
      "No unused seats available. Purchase more seats or unassign another member.",
    );
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

export async function assignOrganizationMemberSeat(params: {
  actorUserId: string;
  organizationId: string;
  memberId: string;
}): Promise<{ memberId: string; seatAssignedAt: Date }> {
  try {
    return await prisma.$transaction(async (tx) => {
      await ensureCanManageSeatAssignments(
        params.actorUserId,
        params.organizationId,
        tx,
      );

      const billingPlan = await resolveOrganizationBillingPlan(
        params.organizationId,
        tx,
      );
      const purchasedSeats = billingPlan.purchasedSeats;
      const subscription =
        billingPlan.mode === "self_serve"
          ? await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
              params.organizationId,
              tx,
            )
          : null;

      const member = await memberRepository.assignSeat(
        params.memberId,
        params.organizationId,
        purchasedSeats,
        tx,
      );

      if (!member.seatAssignedAt) {
        internalServerError("Failed to assign seat");
      }

      const suppressSelfServeSeatCredits =
        billingPlan.mode === "enterprise_contract" && billingPlan.isConsumable;

      if (!suppressSelfServeSeatCredits) {
        await grantUnusedSeatSubscriptionCreditsIfEligible(
          params.organizationId,
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
          params.organizationId,
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
}

export async function unassignOrganizationMemberSeat(params: {
  actorUserId: string;
  organizationId: string;
  memberId: string;
}): Promise<{ memberId: string }> {
  try {
    return await prisma.$transaction(async (tx) => {
      await ensureCanManageSeatAssignments(
        params.actorUserId,
        params.organizationId,
        tx,
      );

      const billingPlan = await resolveOrganizationBillingPlan(
        params.organizationId,
        tx,
      );
      const member = await memberRepository.unassignSeat(
        params.memberId,
        params.organizationId,
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
          params.organizationId,
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
            organizationId: params.organizationId,
            periodEnd: subscription.periodEnd,
          },
          tx,
        );
      } else if (subscription?.periodStart && subscription.periodEnd) {
        await syncLocalFreeOrganizationCreditsIfNeeded(
          params.organizationId,
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
}
