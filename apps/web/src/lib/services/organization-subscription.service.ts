import "server-only";

import { MemberRole } from "@sokosumi/database";
import { memberRepository } from "@sokosumi/database/repositories";
import { APIError } from "better-auth/api";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import prisma from "@/lib/db/prisma";
import { getLatestActiveOrganizationSubscription as getLatestActiveOrganizationSubscriptionQuery } from "@/lib/stripe/subscription-utils";

const stripeInstance = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);

interface ActiveOrganizationSubscription {
  id: string;
  seats: number | null;
  stripeSubscriptionId: string | null;
}

function isOwnerOrAdmin(role: string): boolean {
  return role === MemberRole.OWNER || role === MemberRole.ADMIN;
}

async function getLatestActiveOrganizationSubscription(
  organizationId: string,
): Promise<ActiveOrganizationSubscription | null> {
  return await getLatestActiveOrganizationSubscriptionQuery({
    organizationId,
    select: {
      id: true,
      seats: true,
      stripeSubscriptionId: true,
    },
  });
}

async function getRequiredSeatsForNextMember(
  organizationId: string,
): Promise<number> {
  const currentMembersCount = await prisma.member.count({
    where: {
      organizationId,
    },
  });

  return currentMembersCount + 1;
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

function resolveCurrentSeats(seats: number | null | undefined): number {
  return seats && seats > 0 ? seats : 1;
}

function ensureValidSeatCount(seats: number): void {
  if (!Number.isInteger(seats) || seats < 1) {
    throw new APIError("BAD_REQUEST", {
      message: "Please provide valid plan and seat values",
    });
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
  const stripeSubscriptionId = ensureStripeSubscriptionId(activeSubscription);
  await increaseSubscriptionSeats(stripeSubscriptionId, seats);

  await prisma.subscription.update({
    where: { id: activeSubscription.id },
    data: {
      seats,
    },
  });
}

export const organizationSubscriptionService = (() => {
  return {
    async updateOrganizationSeatsImmediately(
      userId: string,
      organizationId: string,
      seats: number,
    ): Promise<{ seats: number }> {
      ensureValidSeatCount(seats);
      await ensureCanManageOrganizationSubscription(userId, organizationId);
      const activeSubscription = await ensureActiveOrganizationSubscription(
        organizationId,
        "An active organization subscription is required before updating seats.",
      );

      const currentSeats = resolveCurrentSeats(activeSubscription.seats);
      if (currentSeats === seats) {
        return { seats: currentSeats };
      }

      await syncOrganizationSeatCount(activeSubscription, seats);

      return { seats };
    },

    async ensureCanCreateInvitation(organizationId: string): Promise<void> {
      await ensureActiveOrganizationSubscription(
        organizationId,
        "An active organization subscription is required before adding members.",
      );
    },

    async ensureCanAcceptInvitation(organizationId: string): Promise<void> {
      const [requiredSeats, activeSubscription] = await Promise.all([
        getRequiredSeatsForNextMember(organizationId),
        ensureActiveOrganizationSubscription(
          organizationId,
          "An active organization subscription is required before adding members.",
        ),
      ]);

      const currentSeats = resolveCurrentSeats(activeSubscription.seats);
      if (currentSeats >= requiredSeats) {
        return;
      }

      await syncOrganizationSeatCount(activeSubscription, requiredSeats);
    },
  };
})();
