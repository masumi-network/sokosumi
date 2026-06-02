import {
  CreditBucketReferenceType,
  type Prisma,
} from "../generated/prisma/client.js";
import { subscriptionRepository } from "../repositories/subscription.repository.js";
import { creditBucketActivatesAtOrBefore } from "./credit.js";
import { fetchOrganizationMemberUserIds } from "./organization-subscription-credit-audience.js";
import { LOCAL_FREE_SUBSCRIPTION_REFERENCE_CONTAINS } from "./subscription.js";

export interface PaidSubscriptionBlocker {
  plan: string;
  referenceId: string;
  scope: "member" | "organization";
  stripeSubscriptionId: string;
  subscriptionId: string;
  userId?: string;
}

async function hasConsumablePaidSubscriptionPeriodBucket(
  params: {
    now: Date;
    organizationId: string | null;
    userId: string;
  },
  tx: Prisma.TransactionClient,
): Promise<boolean> {
  const bucket = await tx.creditBucket.findFirst({
    where: {
      userId: params.userId,
      organizationId: params.organizationId,
      referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
      NOT: {
        referenceId: {
          contains: LOCAL_FREE_SUBSCRIPTION_REFERENCE_CONTAINS,
        },
      },
      ...creditBucketActivatesAtOrBefore(params.now),
      OR: [{ expiresAt: null }, { expiresAt: { gt: params.now } }],
    },
    select: {
      id: true,
    },
  });

  return bucket != null;
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
): Promise<PaidSubscriptionBlocker[]> {
  const blockers: PaidSubscriptionBlocker[] = [];
  const memberUserIds = await fetchOrganizationMemberUserIds(
    organizationId,
    tx,
  );

  const organizationSubscription =
    await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
      organizationId,
      tx,
      now,
    );

  if (organizationSubscription?.stripeSubscriptionId) {
    const hasConsumableBuckets = await hasConsumableOrgPaidSubscriptionBuckets(
      organizationId,
      memberUserIds,
      now,
      tx,
    );

    if (hasConsumableBuckets) {
      blockers.push({
        plan: organizationSubscription.plan,
        referenceId: organizationId,
        scope: "organization",
        stripeSubscriptionId: organizationSubscription.stripeSubscriptionId,
        subscriptionId: organizationSubscription.id,
      });
    }
  }

  for (const userId of memberUserIds) {
    const personalSubscription =
      await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
        userId,
        tx,
        now,
      );

    if (!personalSubscription?.stripeSubscriptionId) {
      continue;
    }

    const hasConsumableBucket = await hasConsumablePaidSubscriptionPeriodBucket(
      {
        now,
        organizationId: null,
        userId,
      },
      tx,
    );

    if (hasConsumableBucket) {
      blockers.push({
        plan: personalSubscription.plan,
        referenceId: userId,
        scope: "member",
        stripeSubscriptionId: personalSubscription.stripeSubscriptionId,
        subscriptionId: personalSubscription.id,
        userId,
      });
    }
  }

  return blockers;
}
