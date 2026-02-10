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
    },
    {
      idempotencyKey: `${stripeSubscriptionId}:seats:${seats}`,
    },
  );
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

      const currentSeats = activeSubscription.seats ?? 1;
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
