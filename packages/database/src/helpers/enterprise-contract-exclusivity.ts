import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";
import { subscriptionRepository } from "../repositories/subscription.repository.js";
import { netTable, netType } from "../sql-tables.js";
import { getSortedUniqueUserIds } from "./organization-seats.js";
import { LOCAL_FREE_SUBSCRIPTION_REFERENCE_CONTAINS } from "./subscription.js";

export interface PaidSubscriptionBlocker {
  plan: string;
  referenceId: string;
  scope: "organization";
  stripeSubscriptionId: string;
  subscriptionId: string;
}

async function hasConsumablePaidSubscriptionPeriodBucket(
  params: {
    now: Date;
    organizationId: string | null;
    userId: string;
  },
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  const excludedPattern = `%${LOCAL_FREE_SUBSCRIPTION_REFERENCE_CONTAINS}%`;
  const rows =
    params.organizationId === null
      ? await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM ${netTable("mainnet", "credit_bucket")}
          WHERE "userId" = ${params.userId}
            AND "organizationId" IS NULL
            AND "referenceType" = CAST(${CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD}::text AS ${netType("mainnet", "CreditBucketReferenceType")})
            AND NOT ("referenceId" LIKE ${excludedPattern})
            AND ("activatesAt" IS NULL OR "activatesAt" <= ${params.now})
            AND ("expiresAt" IS NULL OR "expiresAt" > ${params.now})
          LIMIT 1
        `
      : await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM ${netTable("mainnet", "credit_bucket")}
          WHERE "userId" = ${params.userId}
            AND "organizationId" = ${params.organizationId}
            AND "referenceType" = CAST(${CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD}::text AS ${netType("mainnet", "CreditBucketReferenceType")})
            AND NOT ("referenceId" LIKE ${excludedPattern})
            AND ("activatesAt" IS NULL OR "activatesAt" <= ${params.now})
            AND ("expiresAt" IS NULL OR "expiresAt" > ${params.now})
          LIMIT 1
        `;

  return rows.length > 0;
}

async function hasConsumableOrgPaidSubscriptionBuckets(
  organizationId: string,
  memberUserIds: string[],
  now: Date,
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  for (const userId of memberUserIds) {
    if (
      await hasConsumablePaidSubscriptionPeriodBucket(
        {
          now,
          organizationId,
          userId,
        },
        tx,
      )
    ) {
      return true;
    }
  }

  return false;
}

export async function findPaidSubscriptionsBlockingEnterpriseActivation(
  organizationId: string,
  tx: Prisma.TransactionClient,
  now: Date = new Date(),
): Promise<PaidSubscriptionBlocker | null> {
  const members = await tx.member.findMany({
    where: {
      organizationId,
    },
    select: {
      userId: true,
    },
    orderBy: [{ userId: "asc" }],
  });
  const memberUserIds = getSortedUniqueUserIds(
    members.map((member) => member.userId),
  );

  const organizationSubscription =
    await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
      organizationId,
      tx,
      now,
    );

  if (!organizationSubscription?.stripeSubscriptionId) {
    return null;
  }

  const hasConsumableBuckets = await hasConsumableOrgPaidSubscriptionBuckets(
    organizationId,
    memberUserIds,
    now,
    tx,
  );

  if (!hasConsumableBuckets) {
    return null;
  }

  return {
    plan: organizationSubscription.plan,
    referenceId: organizationId,
    scope: "organization",
    stripeSubscriptionId: organizationSubscription.stripeSubscriptionId,
    subscriptionId: organizationSubscription.id,
  };
}
