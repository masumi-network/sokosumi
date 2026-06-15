import type { Subscription } from "@sokosumi/database";
import {
  ensureLocalFreeSubscriptionPeriod,
  grantFreeOrganizationMemberSubscriptionCredits,
  resolveOrganizationBillingPlanWithActiveSubscription,
  resolvePurchasedSeats,
} from "@sokosumi/database/helpers";
import {
  memberRepository,
  subscriptionRepository,
} from "@sokosumi/database/repositories";
import { APIError } from "better-auth/api";

import prisma from "@/lib/db/prisma";

interface ActiveOrganizationSubscription {
  createdAt: Date;
  id: string;
  periodEnd: Date | null;
  periodStart: Date | null;
  seats: number | null;
  stripeSubscriptionId: string | null;
}

function toActiveOrganizationSubscription(
  subscription: Subscription | null,
): ActiveOrganizationSubscription | null {
  if (!subscription) {
    return null;
  }

  return {
    createdAt: subscription.createdAt,
    id: subscription.id,
    periodEnd: subscription.periodEnd,
    periodStart: subscription.periodStart,
    seats: subscription.seats,
    stripeSubscriptionId: subscription.stripeSubscriptionId,
  };
}

function ensureSubscriptionPeriodDate(
  value: Date | null,
  fieldName: string,
): Date {
  if (value instanceof Date) {
    return value;
  }

  throw new APIError("INTERNAL_SERVER_ERROR", {
    message: `Organization subscription is missing its ${fieldName}. Please contact support.`,
  });
}

async function syncPaidOrganizationUnassignedFreeCredits(
  organizationId: string,
  activeSubscription: ActiveOrganizationSubscription,
): Promise<number> {
  const purchasedSeats = resolvePurchasedSeats(activeSubscription.seats);
  const periodEnd = activeSubscription.periodEnd;

  if (!periodEnd || periodEnd <= new Date()) {
    return purchasedSeats;
  }

  await prisma.$transaction(async (tx) => {
    const unassignedMemberUserIds =
      await memberRepository.getUnassignedMemberUserIds(organizationId, tx);

    await grantFreeOrganizationMemberSubscriptionCredits(
      {
        memberUserIds: unassignedMemberUserIds,
        organizationId,
        periodEnd,
      },
      tx,
    );
  });

  return purchasedSeats;
}

async function syncLocalFreeOrganizationPeriodCredits(
  organizationId: string,
  activeSubscription: ActiveOrganizationSubscription,
): Promise<number> {
  const periodStart = ensureSubscriptionPeriodDate(
    activeSubscription.periodStart,
    "period start",
  );
  const periodEnd = ensureSubscriptionPeriodDate(
    activeSubscription.periodEnd,
    "period end",
  );
  const purchasedSeats = resolvePurchasedSeats(activeSubscription.seats);

  return await prisma.$transaction(async (tx) => {
    const memberUserIds = await memberRepository.getOrganizationMemberUserIds(
      organizationId,
      tx,
    );

    await ensureLocalFreeSubscriptionPeriod(
      {
        billingAnchorDate: activeSubscription.createdAt,
        memberUserIds,
        organizationId,
        periodEnd,
        periodStart,
        purchasedSeats,
        referenceId: organizationId,
      },
      tx,
    );

    return purchasedSeats;
  });
}

async function syncLocalFreeSeatsAndCreditsForCurrentMembersInternal(
  organizationId: string,
): Promise<number> {
  const { billingPlan, activeSubscription } =
    await resolveOrganizationBillingPlanWithActiveSubscription(
      organizationId,
      prisma,
    );
  if (billingPlan.mode === "enterprise_contract" && billingPlan.isConsumable) {
    return resolvePurchasedSeats(billingPlan.purchasedSeats);
  }

  // For self_serve the active subscription was already fetched above. A
  // non-consumable enterprise contract returns no subscription from the call,
  // so look it up explicitly to preserve prior behavior.
  const rawSubscription =
    billingPlan.mode === "self_serve"
      ? activeSubscription
      : await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
          organizationId,
          prisma,
        );

  const currentActiveSubscription =
    toActiveOrganizationSubscription(rawSubscription);

  if (!currentActiveSubscription) {
    return resolvePurchasedSeats(undefined);
  }

  if (currentActiveSubscription.stripeSubscriptionId) {
    return syncPaidOrganizationUnassignedFreeCredits(
      organizationId,
      currentActiveSubscription,
    );
  }

  return syncLocalFreeOrganizationPeriodCredits(
    organizationId,
    currentActiveSubscription,
  );
}

export async function ensureCanAcceptOrganizationInvitation(
  organizationId: string,
): Promise<void> {
  const { billingPlan, activeSubscription } =
    await resolveOrganizationBillingPlanWithActiveSubscription(
      organizationId,
      prisma,
    );

  if (billingPlan.mode === "enterprise_contract") {
    if (billingPlan.purchasedSeats < 1) {
      throw new APIError("BAD_REQUEST", {
        message:
          "Enterprise contract has no purchased seats configured for this organization.",
      });
    }

    return;
  }

  if (!activeSubscription) {
    throw new APIError("BAD_REQUEST", {
      message:
        "An active organization subscription is required before adding members.",
    });
  }
}

export async function syncLocalFreeSeatsAndCreditsForCurrentMembers(
  organizationId: string,
): Promise<void> {
  await syncLocalFreeSeatsAndCreditsForCurrentMembersInternal(organizationId);
}
