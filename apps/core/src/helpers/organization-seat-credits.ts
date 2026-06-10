import {
  CreditBucketReferenceType,
  type Prisma,
  TaskEventOrigin,
} from "@sokosumi/database";
import {
  buildOrganizationSeatAssignmentSubscriptionReferenceId,
  countOrganizationSubscriptionPeriodSeatGrants,
  FREE_SUBSCRIPTION_PLAN,
  getUnusedSubscriptionSeatCreditSlots,
  hasOrganizationMemberSubscriptionPeriodGrant,
  isActiveSubscriptionStatus,
  resolvePurchasedSeats,
} from "@sokosumi/database/helpers";
import { subscriptionRepository } from "@sokosumi/database/repositories";
import type { PaidSubscriptionPlanName } from "@sokosumi/utils";
import { convertCreditsToCents, TaskStatus } from "@sokosumi/utils";
import Stripe from "stripe";

import { getEnv } from "@/config/env";
import { getSubscriptionCatalogCreditsForPlan } from "@/helpers/subscription-catalog";

const stripe = new Stripe(getEnv().STRIPE_SECRET_KEY, {
  maxNetworkRetries: 0,
});

function isPrismaRecordNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2025"
  );
}

async function markOutOfCreditsTasksAsToppedUp(params: {
  organizationId: string;
  tx: Prisma.TransactionClient;
  userId: string;
}): Promise<void> {
  const tasks = await params.tx.task.findMany({
    where: {
      organizationId: params.organizationId,
      status: TaskStatus.OUT_OF_CREDITS,
    },
    select: {
      id: true,
    },
  });

  for (const task of tasks) {
    try {
      await params.tx.task.update({
        where: {
          id: task.id,
          status: TaskStatus.OUT_OF_CREDITS,
        },
        data: {
          status: TaskStatus.CREDITS_TOPPED_UP,
          events: {
            create: {
              status: TaskStatus.CREDITS_TOPPED_UP,
              origin: TaskEventOrigin.SOKOSUMI,
              userId: params.userId,
              coworkerId: null,
            },
          },
        },
      });
    } catch (error) {
      if (isPrismaRecordNotFoundError(error)) {
        continue;
      }

      throw error;
    }
  }
}

async function resolveCreditsPerSeatForSubscription(
  plan: string,
): Promise<number | null> {
  if (plan === FREE_SUBSCRIPTION_PLAN) {
    return null;
  }

  if (plan === "starter" || plan === "standard" || plan === "pro") {
    return getSubscriptionCatalogCreditsForPlan(
      stripe,
      plan satisfies PaidSubscriptionPlanName,
    );
  }

  return null;
}

export async function grantUnusedSeatSubscriptionCreditsIfEligible(
  organizationId: string,
  userId: string,
  tx: Prisma.TransactionClient,
): Promise<{ creditsGranted: number; granted: boolean }> {
  const subscription =
    await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
      organizationId,
      tx,
    );

  if (
    !subscription?.stripeSubscriptionId ||
    !subscription.periodEnd ||
    !isActiveSubscriptionStatus(subscription.status) ||
    subscription.plan === FREE_SUBSCRIPTION_PLAN
  ) {
    return { creditsGranted: 0, granted: false };
  }

  const periodEnd = subscription.periodEnd;
  const purchasedSeats = resolvePurchasedSeats(subscription.seats);
  const now = new Date();

  if (periodEnd <= now) {
    return { creditsGranted: 0, granted: false };
  }

  const [grantedSeatSlots, memberAlreadyHasGrant, creditsPerSeat] =
    await Promise.all([
      countOrganizationSubscriptionPeriodSeatGrants(organizationId, now, tx),
      hasOrganizationMemberSubscriptionPeriodGrant(
        organizationId,
        userId,
        now,
        tx,
      ),
      resolveCreditsPerSeatForSubscription(subscription.plan),
    ]);

  if (memberAlreadyHasGrant || creditsPerSeat === null || creditsPerSeat <= 0) {
    return { creditsGranted: 0, granted: false };
  }

  const unusedSeatCreditSlots = getUnusedSubscriptionSeatCreditSlots({
    grantedSeatSlots,
    purchasedSeats,
  });

  if (unusedSeatCreditSlots <= 0) {
    return { creditsGranted: 0, granted: false };
  }

  const referenceId = buildOrganizationSeatAssignmentSubscriptionReferenceId(
    userId,
    organizationId,
    periodEnd,
  );
  const existingBucket = await tx.creditBucket.findUnique({
    where: {
      referenceId_referenceType: {
        referenceId,
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
      },
    },
    select: {
      id: true,
    },
  });

  if (existingBucket) {
    return { creditsGranted: 0, granted: false };
  }

  const cents = convertCreditsToCents(creditsPerSeat);
  await tx.transaction.create({
    data: {
      amount: cents,
      organization: {
        connect: {
          id: organizationId,
        },
      },
      sourceCreditBucket: {
        create: {
          amount: cents,
          expiresAt: periodEnd,
          organizationId,
          referenceId,
          referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
          userId,
        },
      },
      user: {
        connect: {
          id: userId,
        },
      },
    },
  });

  await markOutOfCreditsTasksAsToppedUp({
    organizationId,
    tx,
    userId,
  });

  return {
    creditsGranted: creditsPerSeat,
    granted: true,
  };
}
