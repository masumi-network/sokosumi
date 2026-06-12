import {
  FREE_SUBSCRIPTION_PLAN,
  isActiveSubscriptionStatus,
  transitionToNextLocalFreeSubscriptionPeriod,
} from "@sokosumi/database/helpers";
import { subscriptionRepository } from "@sokosumi/database/repositories";
import type Stripe from "stripe";

import prisma from "@/lib/db/prisma";

/**
 * Port of the web app's `apps/web/src/lib/stripe/webhook-handlers.ts`
 * (post-#3135 rump): the Better Auth stripe plugin's subscription lifecycle
 * handlers. `reconcileActiveStripeBackedSubscription` runs on
 * onSubscriptionCreated/Update; `handleSubscriptionDeletedEvent` runs on the
 * plugin's `customer.subscription.deleted` event.
 */

interface StripeBackedSubscriptionForReconciliation {
  id: string;
  plan: string;
  referenceId: string;
  status: string;
  stripeSubscriptionId?: string | null;
}

export async function reconcileActiveStripeBackedSubscription(
  localSubscription: StripeBackedSubscriptionForReconciliation | null,
): Promise<void> {
  if (
    !localSubscription?.stripeSubscriptionId ||
    !isActiveSubscriptionStatus(localSubscription.status) ||
    localSubscription.plan === FREE_SUBSCRIPTION_PLAN
  ) {
    return;
  }

  const settledAt = new Date();
  await prisma.$transaction(async (tx) => {
    const result = await tx.subscription.updateMany({
      where: {
        id: {
          not: localSubscription.id,
        },
        plan: FREE_SUBSCRIPTION_PLAN,
        referenceId: localSubscription.referenceId,
        status: {
          in: ["active", "trialing", "past_due", "unpaid"],
        },
        stripeSubscriptionId: null,
      },
      data: {
        canceledAt: settledAt,
        endedAt: settledAt,
        status: "canceled",
      },
    });

    if (result.count > 0) {
      console.log(
        `✅ Closed ${result.count} local free subscription(s) for reference ${localSubscription.referenceId} after Stripe subscription ${localSubscription.stripeSubscriptionId} became ${localSubscription.status}`,
      );
    }
  });
}

export async function handleSubscriptionDeletedEvent(
  subscription: Stripe.Subscription,
): Promise<void> {
  const localSubscription =
    await subscriptionRepository.getSubscriptionByStripeSubscriptionId(
      subscription.id,
      prisma,
    );

  if (!localSubscription || localSubscription.stripeSubscriptionId === null) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    const latestActiveSubscription =
      await subscriptionRepository.resolveActiveSubscriptionByReferenceId(
        localSubscription.referenceId,
        tx,
      );

    if (
      latestActiveSubscription &&
      latestActiveSubscription.id !== localSubscription.id &&
      latestActiveSubscription.plan !== FREE_SUBSCRIPTION_PLAN
    ) {
      return;
    }

    await transitionToNextLocalFreeSubscriptionPeriod(
      {
        setCanceledAt: true,
        subscription: {
          canceledAt: localSubscription.canceledAt,
          createdAt: localSubscription.createdAt,
          endedAt: localSubscription.endedAt,
          id: localSubscription.id,
          periodEnd: localSubscription.periodEnd,
          referenceId: localSubscription.referenceId,
          seats: localSubscription.seats,
          stripeCustomerId: localSubscription.stripeCustomerId,
          stripeSubscriptionId: localSubscription.stripeSubscriptionId,
        },
      },
      tx,
    );
  });
}
