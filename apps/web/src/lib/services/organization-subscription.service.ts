import "server-only";

import { MemberRole } from "@sokosumi/database";
import { memberRepository } from "@sokosumi/database/repositories";
import { APIError } from "better-auth/api";
import Stripe from "stripe";

import { getEnvSecrets } from "@/config/env.secrets";
import prisma from "@/lib/db/prisma";

const stripeInstance = new Stripe(getEnvSecrets().STRIPE_SECRET_KEY);

const ACTIVE_ORGANIZATION_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
]);

function isOwnerOrAdmin(role: string): boolean {
  return role === MemberRole.OWNER || role === MemberRole.ADMIN;
}

async function getLatestActiveOrganizationSubscription(organizationId: string) {
  return await prisma.subscription.findFirst({
    where: {
      referenceId: organizationId,
      status: {
        in: Array.from(ACTIVE_ORGANIZATION_SUBSCRIPTION_STATUSES),
      },
    },
    orderBy: [{ periodEnd: "desc" }, { updatedAt: "desc" }],
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

  await stripeInstance.subscriptions.update(
    stripeSubscriptionId,
    {
      items: [
        {
          id: firstItem.id,
          quantity: seats,
        },
      ],
      payment_behavior: "error_if_incomplete",
      proration_behavior: "always_invoice",
    },
    {
      idempotencyKey: `${stripeSubscriptionId}:seats:${seats}`,
    },
  );
}

function resolveCurrentSeats(seats: number | null | undefined): number {
  return seats && seats > 0 ? seats : 1;
}

export const organizationSubscriptionService = (() => {
  return {
    async canManageOrganizationSubscription(
      userId: string,
      organizationId: string,
    ): Promise<boolean> {
      const member = await memberRepository.getMemberByUserIdAndOrganizationId(
        userId,
        organizationId,
        prisma,
      );

      if (!member) {
        return false;
      }

      return isOwnerOrAdmin(member.role);
    },

    async updateOrganizationSeatsImmediately(
      userId: string,
      organizationId: string,
      seats: number,
    ): Promise<{ seats: number }> {
      if (!Number.isInteger(seats) || seats < 1) {
        throw new APIError("BAD_REQUEST", {
          message: "Please provide valid plan and seat values",
        });
      }

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

      const activeSubscription =
        await getLatestActiveOrganizationSubscription(organizationId);
      if (!activeSubscription) {
        throw new APIError("BAD_REQUEST", {
          message:
            "An active organization subscription is required before updating seats.",
        });
      }

      const currentSeats = resolveCurrentSeats(activeSubscription.seats);
      if (currentSeats === seats) {
        return { seats: currentSeats };
      }

      if (!activeSubscription.stripeSubscriptionId) {
        throw new APIError("INTERNAL_SERVER_ERROR", {
          message:
            "Organization subscription is missing its Stripe reference. Please contact support.",
        });
      }

      await increaseSubscriptionSeats(activeSubscription.stripeSubscriptionId, seats);

      await prisma.subscription.update({
        where: { id: activeSubscription.id },
        data: {
          seats,
        },
      });

      return { seats };
    },

    async ensureCanInviteOrAcceptMember(organizationId: string): Promise<void> {
      const [requiredSeats, activeSubscription] = await Promise.all([
        getRequiredSeatsForNextMember(organizationId),
        getLatestActiveOrganizationSubscription(organizationId),
      ]);

      if (!activeSubscription) {
        throw new APIError("BAD_REQUEST", {
          message:
            "An active organization subscription is required before adding members.",
        });
      }

      if (!activeSubscription.stripeSubscriptionId) {
        throw new APIError("INTERNAL_SERVER_ERROR", {
          message:
            "Organization subscription is missing its Stripe reference. Please contact support.",
        });
      }

      const currentSeats = resolveCurrentSeats(activeSubscription.seats);
      if (currentSeats >= requiredSeats) {
        return;
      }

      await increaseSubscriptionSeats(
        activeSubscription.stripeSubscriptionId,
        requiredSeats,
      );

      await prisma.subscription.update({
        where: { id: activeSubscription.id },
        data: {
          seats: requiredSeats,
        },
      });
    },
  };
})();
