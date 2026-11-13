import { ACTIVE_SUBSCRIPTION_STATUSES } from "@sokosumi/database/helpers";

import prisma from "@/lib/db/prisma";

/**
 * Direct Prisma form of `subscriptionRepository.resolveActiveSubscriptionByReferenceId`.
 * In-period active row first (a Stripe-backed row wins over a local free row),
 * otherwise the latest started active row. The repository stays for its other callers.
 */
export async function resolveActiveSubscription(referenceId: string) {
  const now = new Date();
  const inPeriod = await prisma.subscription.findMany({
    where: {
      referenceId,
      status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
      periodStart: { lte: now },
      periodEnd: { gt: now },
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  const current =
    inPeriod.find((row) => row.stripeSubscriptionId) ?? inPeriod[0] ?? null;
  if (current) {
    return current;
  }

  return await prisma.subscription.findFirst({
    where: {
      referenceId,
      status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] },
      OR: [{ periodStart: null }, { periodStart: { lte: now } }],
    },
    orderBy: [
      { periodEnd: { sort: "desc", nulls: "last" } },
      { updatedAt: "desc" },
    ],
  });
}
