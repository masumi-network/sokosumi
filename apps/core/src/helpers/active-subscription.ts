import type { Prisma } from "@sokosumi/database";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "@sokosumi/database/helpers";

type SubscriptionClient = Pick<Prisma.TransactionClient, "subscription">;

/**
 * Current in-period active row, else latest started active row by `periodEnd`.
 */
export async function findActiveSubscriptionByReferenceId(
  referenceId: string,
  tx: SubscriptionClient,
  now: Date = new Date(),
) {
  const activeStatus = { in: [...ACTIVE_SUBSCRIPTION_STATUSES] };
  return (
    (await tx.subscription.findFirst({
      where: {
        referenceId,
        status: activeStatus,
        periodStart: { lte: now },
        periodEnd: { gt: now },
      },
      orderBy: [{ updatedAt: "desc" }],
    })) ??
    (await tx.subscription.findFirst({
      where: {
        referenceId,
        status: activeStatus,
        OR: [{ periodStart: null }, { periodStart: { lte: now } }],
      },
      orderBy: [
        { periodEnd: { sort: "desc", nulls: "last" } },
        { updatedAt: "desc" },
      ],
    }))
  );
}
