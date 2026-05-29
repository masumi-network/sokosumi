import "server-only";

import { MemberRole } from "@sokosumi/database";
import {
  ensureLocalFreeSubscriptionPeriod,
  ensurePurchasedSeatsSufficient,
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

const stripeInstance = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);

interface ActiveOrganizationSubscription {
  createdAt: Date;
  id: string;
  periodEnd: Date | null;
  periodStart: Date | null;
  seats: number | null;
  stripeSubscriptionId: string | null;
}

function isOwnerOrAdmin(role: string): boolean {
  return role === MemberRole.OWNER || role === MemberRole.ADMIN;
}

async function getLatestActiveOrganizationSubscription(
  organizationId: string,
): Promise<ActiveOrganizationSubscription | null> {
  const subscription =
    await subscriptionRepository.getLatestActiveSubscriptionByReferenceId(
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
  if (!member || !isOwnerOrAdmin(member.role)) {
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
    await getLatestActiveOrganizationSubscription(organizationId);
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

async function syncLocalFreeSeatsAndCreditsForCurrentMembersInternal(
  organizationId: string,
  activeSubscription?: ActiveOrganizationSubscription | null,
): Promise<number> {
  const currentActiveSubscription =
    activeSubscription ??
    (await getLatestActiveOrganizationSubscription(organizationId));

  if (
    !currentActiveSubscription ||
    currentActiveSubscription.stripeSubscriptionId
  ) {
    return resolvePurchasedSeats(currentActiveSubscription?.seats);
  }

  const periodStart = ensureSubscriptionPeriodDate(
    currentActiveSubscription.periodStart,
    "period start",
  );
  const periodEnd = ensureSubscriptionPeriodDate(
    currentActiveSubscription.periodEnd,
    "period end",
  );
  const purchasedSeats = resolvePurchasedSeats(currentActiveSubscription.seats);

  return await prisma.$transaction(async (tx) => {
    const unassignedMemberUserIds =
      await memberRepository.getUnassignedMemberUserIds(organizationId, tx);

    await ensureLocalFreeSubscriptionPeriod(
      {
        billingAnchorDate: currentActiveSubscription.createdAt,
        memberUserIds: unassignedMemberUserIds,
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

export const organizationSubscriptionService = (() => {
  return {
    async updateOrganizationSeatsImmediately(
      userId: string,
      organizationId: string,
      seats: number,
    ): Promise<{ seats: number }> {
      await ensureCanManageOrganizationSubscription(userId, organizationId);
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
