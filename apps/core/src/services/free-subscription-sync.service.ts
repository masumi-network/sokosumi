import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  ensureLocalFreeSubscriptionPeriod,
  FREE_SUBSCRIPTION_PLAN,
  getNextMonthlyPeriodEnd,
} from "@sokosumi/database/helpers";

import { stripeClient } from "@/clients/stripe.client";
import prisma from "@/lib/db/prisma";

const MIN_STRIPE_REQUEST_TIMEOUT_MS = 1000;
const LEGACY_STRIPE_FREE_SUBSCRIPTION_STATUSES = [
  ...ACTIVE_SUBSCRIPTION_STATUSES,
  "incomplete",
  "paused",
] as const;

interface SyncExecutionOptions {
  deadlineMs: number;
  msRemaining: () => number;
  shouldContinue: () => boolean;
}

interface StripeBackedSubscriptionRecord {
  cancelAtPeriodEnd: boolean | null;
  canceledAt: Date | null;
  createdAt: Date;
  endedAt: Date | null;
  id: string;
  periodEnd: Date | null;
  referenceId: string;
  seats: number | null;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

interface LocalFreeSubscriptionRecord {
  cancelAtPeriodEnd: boolean | null;
  canceledAt: Date | null;
  createdAt: Date;
  endedAt: Date | null;
  id: string;
  periodEnd: Date | null;
  referenceId: string;
  seats: number | null;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: null;
}

type FreeSubscriptionRecord =
  | LocalFreeSubscriptionRecord
  | StripeBackedSubscriptionRecord;

interface SubscriptionPeriod {
  periodEnd: Date;
  periodStart: Date;
}

interface LocalFreeSubscriptionPeriodRecord extends SubscriptionPeriod {
  referenceId: string;
}

function hasTimeRemaining(deadlineMs: number): boolean {
  return Date.now() < deadlineMs;
}

function shouldStopSync(
  options: SyncExecutionOptions,
  reason: string,
): boolean {
  if (!options.shouldContinue()) {
    console.info(`[sync/free-subscriptions] ${reason}`);
    return true;
  }

  if (!hasTimeRemaining(options.deadlineMs)) {
    console.info(`[sync/free-subscriptions] ${reason}`);
    return true;
  }

  return false;
}

function getStripeRequestTimeoutMs(options: SyncExecutionOptions): number {
  const remainingMs = Math.min(
    options.msRemaining(),
    options.deadlineMs - Date.now(),
  );

  return Math.max(MIN_STRIPE_REQUEST_TIMEOUT_MS, remainingMs);
}

function getNextLocalFreeSubscriptionPeriod(
  subscription: FreeSubscriptionRecord,
): null | SubscriptionPeriod {
  if (!subscription.periodEnd) {
    return null;
  }

  const periodStart = new Date(subscription.periodEnd.getTime());

  return {
    periodEnd: getNextMonthlyPeriodEnd(periodStart, subscription.createdAt),
    periodStart,
  };
}

function isLocalFreeSubscriptionRecord(
  subscription: FreeSubscriptionRecord,
): subscription is LocalFreeSubscriptionRecord {
  return subscription.stripeSubscriptionId === null;
}

function buildLocalFreeSubscriptionPeriodKey(
  record: LocalFreeSubscriptionPeriodRecord,
): string {
  return `${record.referenceId}:${record.periodStart.toISOString()}:${record.periodEnd.toISOString()}`;
}

async function filterSubscriptionsMissingNextLocalSuccessor<
  TSubscription extends FreeSubscriptionRecord,
>(subscriptions: TSubscription[]): Promise<TSubscription[]> {
  const successorPeriods = new Map<string, LocalFreeSubscriptionPeriodRecord>();

  for (const subscription of subscriptions) {
    const nextPeriod = getNextLocalFreeSubscriptionPeriod(subscription);

    if (!nextPeriod) {
      continue;
    }

    const successorRecord = {
      periodEnd: nextPeriod.periodEnd,
      periodStart: nextPeriod.periodStart,
      referenceId: subscription.referenceId,
    } satisfies LocalFreeSubscriptionPeriodRecord;

    successorPeriods.set(
      buildLocalFreeSubscriptionPeriodKey(successorRecord),
      successorRecord,
    );
  }

  if (successorPeriods.size === 0) {
    return subscriptions.filter((subscription) => subscription.periodEnd);
  }

  const existingLocalSuccessors = await prisma.subscription.findMany({
    where: {
      OR: Array.from(successorPeriods.values()).map((successorPeriod) => ({
        periodEnd: successorPeriod.periodEnd,
        periodStart: successorPeriod.periodStart,
        plan: FREE_SUBSCRIPTION_PLAN,
        referenceId: successorPeriod.referenceId,
        stripeSubscriptionId: null,
      })),
    },
    select: {
      periodEnd: true,
      periodStart: true,
      referenceId: true,
    },
  });

  const existingSuccessorKeys = new Set(
    existingLocalSuccessors.flatMap((successor) => {
      if (!successor.periodStart || !successor.periodEnd) {
        return [];
      }

      return [
        buildLocalFreeSubscriptionPeriodKey({
          periodEnd: successor.periodEnd,
          periodStart: successor.periodStart,
          referenceId: successor.referenceId,
        }),
      ];
    }),
  );

  return subscriptions.filter((subscription) => {
    const nextPeriod = getNextLocalFreeSubscriptionPeriod(subscription);

    if (!nextPeriod) {
      return false;
    }

    return !existingSuccessorKeys.has(
      buildLocalFreeSubscriptionPeriodKey({
        periodEnd: nextPeriod.periodEnd,
        periodStart: nextPeriod.periodStart,
        referenceId: subscription.referenceId,
      }),
    );
  });
}

async function markStripeSubscriptionToCancelAtPeriodEnd(
  subscription: StripeBackedSubscriptionRecord,
  options: SyncExecutionOptions,
): Promise<void> {
  if (!subscription.stripeSubscriptionId) {
    return;
  }

  const requestTimeoutMs = getStripeRequestTimeoutMs(options);
  await stripeClient.updateSubscriptionCancelAtPeriodEnd(
    subscription.stripeSubscriptionId,
    true,
    {
      timeout: requestTimeoutMs,
    },
  );

  await prisma.subscription.update({
    where: {
      id: subscription.id,
    },
    data: {
      cancelAt: subscription.periodEnd,
      cancelAtPeriodEnd: true,
    },
  });
}

type NextLocalFreePeriodSubscription = Pick<
  FreeSubscriptionRecord,
  | "canceledAt"
  | "createdAt"
  | "endedAt"
  | "id"
  | "periodEnd"
  | "referenceId"
  | "stripeCustomerId"
>;

async function transitionToNextLocalFreeSubscriptionPeriod(
  subscription: NextLocalFreePeriodSubscription,
  options: {
    operationKind: "migrate" | "renew-local-free";
    setCanceledAtOnCloseOut: boolean;
  },
): Promise<void> {
  if (!subscription.periodEnd) {
    return;
  }

  const periodStart = new Date(subscription.periodEnd.getTime());
  const periodEnd = getNextMonthlyPeriodEnd(
    periodStart,
    subscription.createdAt,
  );
  const settledAt = new Date();

  await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.findUnique({
      where: {
        id: subscription.referenceId,
      },
      select: {
        id: true,
      },
    });

    if (organization) {
      const members = await tx.member.findMany({
        where: {
          organizationId: organization.id,
        },
        select: {
          role: true,
          userId: true,
        },
      });

      if (members.length === 0) {
        const prefix =
          options.operationKind === "migrate"
            ? `Cannot migrate subscription ${subscription.id}`
            : `Cannot renew local free subscription ${subscription.id}`;
        throw new Error(
          `${prefix}: organization ${organization.id} has no members`,
        );
      }

      await ensureLocalFreeSubscriptionPeriod(
        {
          memberUserIds: members.map((member) => member.userId),
          organizationId: organization.id,
          periodEnd,
          periodStart,
          referenceId: organization.id,
          stripeCustomerId: subscription.stripeCustomerId,
        },
        tx,
      );
    } else {
      const user = await tx.user.findUnique({
        where: {
          id: subscription.referenceId,
        },
        select: {
          id: true,
        },
      });

      if (!user) {
        await tx.subscription.update({
          where: {
            id: subscription.id,
          },
          data: {
            canceledAt: subscription.canceledAt ?? settledAt,
            endedAt: subscription.endedAt ?? periodStart,
            status: "canceled",
          },
        });
        return;
      }

      await ensureLocalFreeSubscriptionPeriod(
        {
          organizationId: null,
          userId: user.id,
          periodEnd,
          periodStart,
          referenceId: user.id,
          stripeCustomerId: subscription.stripeCustomerId,
        },
        tx,
      );
    }

    await tx.subscription.update({
      where: {
        id: subscription.id,
      },
      data: {
        ...(options.setCanceledAtOnCloseOut
          ? { canceledAt: subscription.canceledAt ?? settledAt }
          : {}),
        endedAt: subscription.endedAt ?? periodStart,
        status: "canceled",
      },
    });
  });
}

async function migrateStripeBackedSubscriptionToLocalFree(
  subscription: StripeBackedSubscriptionRecord,
): Promise<void> {
  await transitionToNextLocalFreeSubscriptionPeriod(subscription, {
    operationKind: "migrate",
    setCanceledAtOnCloseOut: true,
  });
}

async function renewLocalFreeSubscriptionPeriod(
  subscription: LocalFreeSubscriptionRecord,
): Promise<void> {
  await transitionToNextLocalFreeSubscriptionPeriod(subscription, {
    operationKind: "renew-local-free",
    setCanceledAtOnCloseOut: false,
  });
}

async function syncLegacyStripeFreeSubscriptions(
  options: SyncExecutionOptions,
): Promise<void> {
  const now = new Date();
  const subscriptionsToCancelAtPeriodEnd = await prisma.subscription.findMany({
    where: {
      NOT: {
        cancelAtPeriodEnd: true,
      },
      plan: FREE_SUBSCRIPTION_PLAN,
      periodEnd: {
        gt: now,
      },
      status: {
        in: [...LEGACY_STRIPE_FREE_SUBSCRIPTION_STATUSES],
      },
      stripeSubscriptionId: {
        not: null,
      },
    },
    orderBy: [{ periodEnd: "asc" }, { updatedAt: "asc" }],
    select: {
      cancelAtPeriodEnd: true,
      canceledAt: true,
      createdAt: true,
      endedAt: true,
      id: true,
      periodEnd: true,
      referenceId: true,
      seats: true,
      status: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
    },
  });

  for (const subscription of subscriptionsToCancelAtPeriodEnd) {
    if (
      shouldStopSync(
        options,
        "Stopping before marking more Stripe-backed free subscriptions to cancel",
      )
    ) {
      return;
    }

    try {
      await markStripeSubscriptionToCancelAtPeriodEnd(subscription, options);
    } catch (error) {
      console.error(
        `Failed to schedule Stripe-backed free subscription ${subscription.id} for cancel at period end:`,
        error,
      );
    }
  }

  const dueStripeBackedSubscriptions = await prisma.subscription.findMany({
    where: {
      plan: FREE_SUBSCRIPTION_PLAN,
      periodEnd: {
        lte: now,
      },
      OR: [
        {
          cancelAtPeriodEnd: true,
        },
        {
          status: "canceled",
        },
        {
          endedAt: {
            not: null,
          },
        },
        {
          canceledAt: {
            not: null,
          },
        },
      ],
      stripeSubscriptionId: {
        not: null,
      },
    },
    orderBy: [{ periodEnd: "asc" }, { updatedAt: "asc" }],
    select: {
      cancelAtPeriodEnd: true,
      canceledAt: true,
      createdAt: true,
      endedAt: true,
      id: true,
      periodEnd: true,
      referenceId: true,
      seats: true,
      status: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
    },
  });
  const subscriptionsNeedingMigration =
    await filterSubscriptionsMissingNextLocalSuccessor(
      dueStripeBackedSubscriptions,
    );

  for (const subscription of subscriptionsNeedingMigration) {
    if (
      shouldStopSync(
        options,
        "Stopping before migrating more ended Stripe-backed subscriptions to local free",
      )
    ) {
      return;
    }

    try {
      await migrateStripeBackedSubscriptionToLocalFree(subscription);
    } catch (error) {
      console.error(
        `Failed to migrate Stripe-backed subscription ${subscription.id} to local free:`,
        error,
      );
    }
  }
}

async function renewLocalFreeSubscriptions(
  options: SyncExecutionOptions,
): Promise<void> {
  const attemptedSubscriptionIds = new Set<string>();

  while (true) {
    if (
      shouldStopSync(
        options,
        "Stopping before querying more local free subscriptions for renewal",
      )
    ) {
      return;
    }

    const dueLocalFreeSubscriptions = await prisma.subscription.findMany({
      where: {
        plan: FREE_SUBSCRIPTION_PLAN,
        periodEnd: {
          lte: new Date(),
        },
        status: {
          in: [...ACTIVE_SUBSCRIPTION_STATUSES],
        },
        stripeSubscriptionId: null,
      },
      orderBy: [{ periodEnd: "asc" }, { updatedAt: "asc" }],
      select: {
        cancelAtPeriodEnd: true,
        canceledAt: true,
        createdAt: true,
        endedAt: true,
        id: true,
        periodEnd: true,
        referenceId: true,
        seats: true,
        status: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
      },
    });
    const subscriptionsNeedingRenewal =
      await filterSubscriptionsMissingNextLocalSuccessor(
        dueLocalFreeSubscriptions.filter(
          (subscription) => !attemptedSubscriptionIds.has(subscription.id),
        ),
      );
    const localSubscriptionsNeedingRenewal = subscriptionsNeedingRenewal.filter(
      isLocalFreeSubscriptionRecord,
    );

    if (localSubscriptionsNeedingRenewal.length === 0) {
      return;
    }

    for (const subscription of localSubscriptionsNeedingRenewal) {
      if (
        shouldStopSync(
          options,
          "Stopping before renewing more local free subscriptions",
        )
      ) {
        return;
      }

      attemptedSubscriptionIds.add(subscription.id);

      try {
        await renewLocalFreeSubscriptionPeriod(subscription);
      } catch (error) {
        console.error(
          `Failed to renew local free subscription ${subscription.id}:`,
          error,
        );
      }
    }
  }
}

export const freeSubscriptionSyncService = {
  async syncLegacyStripeFreeSubscriptions(
    options: SyncExecutionOptions,
  ): Promise<void> {
    await syncLegacyStripeFreeSubscriptions(options);
  },

  async renewLocalFreeSubscriptions(
    options: SyncExecutionOptions,
  ): Promise<void> {
    await renewLocalFreeSubscriptions(options);
  },
};
