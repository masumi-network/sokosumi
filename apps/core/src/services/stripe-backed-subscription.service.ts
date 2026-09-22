import {
  autoAssignSeatsOnPaidSubscribe,
  FREE_SUBSCRIPTION_PLAN,
  isActiveSubscriptionStatus,
  transitionToNextLocalFreeSubscriptionPeriod,
  unassignSeatsOverPurchasedCapacity,
} from "@sokosumi/database/helpers";
import { subscriptionRepository } from "@sokosumi/database/repositories";
import type Stripe from "stripe";

import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { SEAT_RECONCILIATION_CONFLICT_MESSAGE } from "@/services/organization-seat.service";

interface StripeBackedSubscriptionForReconciliation {
  id: string;
  plan: string;
  referenceId: string;
  seats?: number | null;
  status: string;
  stripeSubscriptionId?: string | null;
}

export async function reconcileActiveStripeBackedSubscription(
  localSubscription: StripeBackedSubscriptionForReconciliation | null,
  options: { autoAssignIfUnassigned: boolean } = {
    autoAssignIfUnassigned: false,
  },
): Promise<void> {
  if (
    !localSubscription?.stripeSubscriptionId ||
    !isActiveSubscriptionStatus(localSubscription.status) ||
    localSubscription.plan === FREE_SUBSCRIPTION_PLAN
  ) {
    return;
  }

  const settledAt = new Date();
  // Serializable so the seat reconciliation commits as one unit (SOK-1007).
  // Postgres only aborts a serialization anomaly when both sides run at this
  // level, so an auto-assign here has to match the assignment routes or it can
  // still push an organization past its purchased seats.
  await serializableTransaction(async (tx) => {
    await tx.subscription.updateMany({
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

    const organization = await tx.organization.findUnique({
      where: { id: localSubscription.referenceId },
      select: { id: true },
    });
    if (!organization) {
      return;
    }

    await unassignSeatsOverPurchasedCapacity(
      organization.id,
      localSubscription.seats,
      tx,
    );

    if (!options.autoAssignIfUnassigned) {
      return;
    }

    const assignedSeats = await tx.member.count({
      where: {
        organizationId: organization.id,
        seatAssignedAt: {
          not: null,
        },
      },
    });
    if (assignedSeats > 0) {
      return;
    }

    await autoAssignSeatsOnPaidSubscribe(
      organization.id,
      localSubscription.seats,
      tx,
    );
  }, SEAT_RECONCILIATION_CONFLICT_MESSAGE);
}

export async function handleCheckoutSessionCompletedEvent(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const stripeSubscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  if (!stripeSubscriptionId) {
    return;
  }

  await reconcileFirstPaidSubscription(stripeSubscriptionId);
}

export async function handleSubscriptionCreatedEvent(
  subscription: Stripe.Subscription,
): Promise<void> {
  await reconcileFirstPaidSubscription(subscription.id);
}

async function reconcileFirstPaidSubscription(
  stripeSubscriptionId: string,
): Promise<void> {
  const localSubscription =
    await subscriptionRepository.getSubscriptionByStripeSubscriptionId(
      stripeSubscriptionId,
      prisma,
    );

  await reconcileActiveStripeBackedSubscription(localSubscription, {
    autoAssignIfUnassigned: true,
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
