import "server-only";

import prisma from "@/lib/db/prisma";

export const ACTIVE_ORGANIZATION_SUBSCRIPTION_STATUSES = [
  "active",
  "trialing",
  "past_due",
  "unpaid",
] as const;

interface GetLatestActiveOrganizationSubscriptionOptions {
  organizationId: string;
  select?: {
    id?: boolean;
    seats?: boolean;
    stripeSubscriptionId?: boolean;
  };
}

export async function getLatestActiveOrganizationSubscription(
  options: GetLatestActiveOrganizationSubscriptionOptions,
) {
  return await prisma.subscription.findFirst({
    where: {
      referenceId: options.organizationId,
      status: {
        in: [...ACTIVE_ORGANIZATION_SUBSCRIPTION_STATUSES],
      },
    },
    orderBy: [{ periodEnd: "desc" }, { updatedAt: "desc" }],
    select: options.select,
  });
}

export async function getLatestActivePaidOrganizationSubscription(
  options: GetLatestActiveOrganizationSubscriptionOptions,
) {
  return await prisma.subscription.findFirst({
    where: {
      referenceId: options.organizationId,
      plan: {
        not: "free",
      },
      status: {
        in: [...ACTIVE_ORGANIZATION_SUBSCRIPTION_STATUSES],
      },
    },
    orderBy: [{ periodEnd: "desc" }, { updatedAt: "desc" }],
    select: options.select,
  });
}
