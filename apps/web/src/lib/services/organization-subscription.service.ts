import "server-only";

import {
  assertOrganizationSubscriptionChangeAllowed,
  ensureLocalFreeSubscriptionPeriod,
  ensurePurchasedSeatsSufficient,
  grantFreeOrganizationMemberSubscriptionCredits,
  OrganizationSubscriptionExclusivityError,
  resolveOrganizationBillingPlan,
  resolvePurchasedSeats,
} from "@sokosumi/database/helpers";
import {
  memberRepository,
  subscriptionRepository,
} from "@sokosumi/database/repositories";
import { APIError } from "better-auth/api";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import prisma from "@/lib/db/prisma";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";

const stripeInstance = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);

interface ActiveOrganizationSubscription {
  createdAt: Date;
  id: string;
  periodEnd: Date | null;
  periodStart: Date | null;
  seats: number | null;
  stripeSubscriptionId: string | null;
}

async function resolveActiveOrganizationSubscription(
  organizationId: string,
): Promise<ActiveOrganizationSubscription | null> {
  const subscription =
    await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
      organizationId,
      prisma,
    );

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

async function getAssignedMemberCount(organizationId: string): Promise<number> {
  return await memberRepository.getAssignedMemberCount(organizationId, prisma);
}

async function increaseSubscriptionSeats(
  stripeSubscriptionId: string,
  seats: number,
): Promise<void> {
  const stripeSubscription = await stripeInstance.subscriptions.retrieve(
    stripeSubscriptionId,
    { expand: ["items"] },
  );

  const firstItem = stripeSubscription.items.data[0];
  if (!firstItem) {
    throw new APIError("INTERNAL_SERVER_ERROR", {
      message:
        "Unable to update organization subscription seats: missing Stripe subscription item",
    });
  }

  const updatePayload: Stripe.SubscriptionUpdateParams = {
    items: [
      {
        id: firstItem.id,
        quantity: seats,
      },
    ],
    payment_behavior: "error_if_incomplete",
    proration_behavior: "always_invoice",
  };
  await stripeInstance.subscriptions.update(
    stripeSubscriptionId,
    updatePayload,
  );
}

function ensureValidPurchasedSeatCount(
  seats: number,
  assignedCount?: number,
): void {
  if (!Number.isInteger(seats) || seats < 1) {
    throw new APIError("BAD_REQUEST", {
      message: "Please provide valid plan and seat values",
    });
  }

  if (assignedCount !== undefined) {
    try {
      ensurePurchasedSeatsSufficient(seats, assignedCount);
    } catch (error) {
      throw new APIError("BAD_REQUEST", {
        message:
          error instanceof Error
            ? error.message
            : `Seats must be at least ${assignedCount} to cover all assigned members`,
      });
    }
  }
}

async function ensureCanManageOrganizationSubscription(
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
      message: "Only organization owners and admins can manage subscriptions",
    });
  }
}

async function ensureActiveOrganizationSubscription(
  organizationId: string,
  missingSubscriptionMessage: string,
): Promise<ActiveOrganizationSubscription> {
  const activeSubscription =
    await resolveActiveOrganizationSubscription(organizationId);
  if (!activeSubscription) {
    throw new APIError("BAD_REQUEST", {
      message: missingSubscriptionMessage,
    });
  }

  return activeSubscription;
}

function ensureStripeSubscriptionId(
  activeSubscription: ActiveOrganizationSubscription,
): string {
  if (!activeSubscription.stripeSubscriptionId) {
    throw new APIError("INTERNAL_SERVER_ERROR", {
      message:
        "Organization subscription is missing its Stripe reference. Please contact support.",
    });
  }

  return activeSubscription.stripeSubscriptionId;
}

async function syncOrganizationSeatCount(
  activeSubscription: ActiveOrganizationSubscription,
  seats: number,
): Promise<void> {
  if (!activeSubscription.stripeSubscriptionId) {
    await prisma.subscription.update({
      where: { id: activeSubscription.id },
      data: {
        seats,
      },
    });
    return;
  }

  const stripeSubscriptionId = ensureStripeSubscriptionId(activeSubscription);
  await increaseSubscriptionSeats(stripeSubscriptionId, seats);

  await prisma.subscription.update({
    where: { id: activeSubscription.id },
    data: {
      seats,
    },
  });
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
  activeSubscription?: ActiveOrganizationSubscription | null,
): Promise<number> {
  const billingPlan = await resolveOrganizationBillingPlan(
    organizationId,
    prisma,
  );
  if (billingPlan.mode === "enterprise_contract" && billingPlan.isConsumable) {
    return resolvePurchasedSeats(billingPlan.purchasedSeats);
  }

  const currentActiveSubscription =
    activeSubscription ??
    (await resolveActiveOrganizationSubscription(organizationId));

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

export const organizationSubscriptionService = (() => {
  return {
    async updateOrganizationSeatsImmediately(
      userId: string,
      organizationId: string,
      seats: number,
    ): Promise<{ seats: number }> {
      await ensureCanManageOrganizationSubscription(userId, organizationId);

      try {
        await assertOrganizationSubscriptionChangeAllowed(
          organizationId,
          prisma,
        );
      } catch (error) {
        if (error instanceof OrganizationSubscriptionExclusivityError) {
          throw new APIError("BAD_REQUEST", {
            message: error.message,
          });
        }

        throw error;
      }

      const activeSubscription = await ensureActiveOrganizationSubscription(
        organizationId,
        "An active organization subscription is required before updating seats.",
      );
      const assignedCount = await getAssignedMemberCount(organizationId);
      ensureValidPurchasedSeatCount(seats, assignedCount);

      if (!activeSubscription.stripeSubscriptionId) {
        await syncOrganizationSeatCount(activeSubscription, seats);
        return { seats };
      }

      const currentSeats = resolvePurchasedSeats(activeSubscription.seats);
      if (currentSeats === seats) {
        return { seats: currentSeats };
      }

      await syncOrganizationSeatCount(activeSubscription, seats);

      return { seats };
    },

    async ensureCanCreateInvitation(_organizationId: string): Promise<void> {
      return;
    },

    async ensureCanAcceptInvitation(organizationId: string): Promise<void> {
      const billingPlan = await resolveOrganizationBillingPlan(
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

      await ensureActiveOrganizationSubscription(
        organizationId,
        "An active organization subscription is required before adding members.",
      );
    },

    async syncLocalFreeSeatsAndCreditsForCurrentMembers(
      organizationId: string,
    ): Promise<void> {
      await syncLocalFreeSeatsAndCreditsForCurrentMembersInternal(
        organizationId,
      );
    },
  };
})();
