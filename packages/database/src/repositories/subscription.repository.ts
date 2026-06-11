import type { Prisma, Subscription } from "../generated/prisma/client.js";
import { ACTIVE_SUBSCRIPTION_STATUSES } from "../helpers/subscription.js";

function activeSubscriptionStatusWhere(): Prisma.SubscriptionWhereInput {
  return {
    status: {
      in: [...ACTIVE_SUBSCRIPTION_STATUSES],
    },
  };
}

/** `periodStart` unset or on/before `now` (excludes pre-created future periods). */
function subscriptionPeriodStartedAtOrBefore(
  now: Date,
): Prisma.SubscriptionWhereInput {
  return {
    OR: [{ periodStart: null }, { periodStart: { lte: now } }],
  };
}

export const subscriptionRepository = {
  async getSubscriptionByStripeSubscriptionId(
    stripeSubscriptionId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Subscription | null> {
    return await tx.subscription.findFirst({
      where: {
        stripeSubscriptionId,
      },
      orderBy: [{ updatedAt: "desc" }],
    });
  },

  async getLatestSubscriptionByReferenceId(
    referenceId: string,
    tx: Prisma.TransactionClient,
  ): Promise<Subscription | null> {
    return await tx.subscription.findFirst({
      where: {
        referenceId,
      },
      orderBy: [
        { periodEnd: { sort: "desc", nulls: "last" } },
        { updatedAt: "desc" },
      ],
    });
  },

  /**
   * Active subscription whose billing period contains `now`
   * (`periodStart <= now < periodEnd`). Use when credits/UI must reflect the
   * period the customer is in, not a pre-created successor row.
   */
  async getCurrentInPeriodActiveSubscriptionByReferenceId(
    referenceId: string,
    tx: Prisma.TransactionClient,
    now: Date = new Date(),
  ): Promise<Subscription | null> {
    return await tx.subscription.findFirst({
      where: {
        referenceId,
        ...activeSubscriptionStatusWhere(),
        periodStart: {
          lte: now,
        },
        periodEnd: {
          gt: now,
        },
      },
      orderBy: [{ updatedAt: "desc" }],
    });
  },

  /**
   * Active subscription with the latest `periodEnd` among rows whose period has
   * started (`periodStart` null or `<= now`). Excludes pre-created successors
   * whose `periodStart` is still in the future.
   */
  async getLatestStartedActiveSubscriptionByReferenceId(
    referenceId: string,
    tx: Prisma.TransactionClient,
    now: Date = new Date(),
  ): Promise<Subscription | null> {
    return await tx.subscription.findFirst({
      where: {
        referenceId,
        ...activeSubscriptionStatusWhere(),
        ...subscriptionPeriodStartedAtOrBefore(now),
      },
      orderBy: [
        { periodEnd: { sort: "desc", nulls: "last" } },
        { updatedAt: "desc" },
      ],
    });
  },

  /**
   * Billing/credits resolution: current in-period row when one exists, otherwise
   * the latest started active row by `periodEnd` (ended periods, missing dates).
   */
  async resolveActiveSubscriptionByReferenceId(
    referenceId: string,
    tx: Prisma.TransactionClient,
    now: Date = new Date(),
  ): Promise<Subscription | null> {
    return (
      (await subscriptionRepository.getCurrentInPeriodActiveSubscriptionByReferenceId(
        referenceId,
        tx,
        now,
      )) ??
      (await subscriptionRepository.getLatestStartedActiveSubscriptionByReferenceId(
        referenceId,
        tx,
        now,
      ))
    );
  },
};
