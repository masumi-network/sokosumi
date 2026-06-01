import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  FREE_SUBSCRIPTION_PLAN,
  getNextMonthlyPeriodEnd,
  transitionToNextLocalFreeSubscriptionPeriod,
} from "@sokosumi/database/helpers";

import prisma from "@/lib/db/prisma";

const LOG_PREFIX = "[sync/free-subscriptions-renewal]";

interface SyncExecutionOptions {
  deadlineMs: number;
  msRemaining: () => number;
  shouldContinue: () => boolean;
}

export interface FreeSubscriptionRenewalSyncResult {
  renewalErrors: number;
  renewed: number;
  stoppedEarly: boolean;
}

interface LocalFreeSubscriptionRecord {
  canceledAt: Date | null;
  createdAt: Date;
  endedAt: Date | null;
  id: string;
  periodEnd: Date | null;
  referenceId: string;
  seats: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: null;
}

interface LocalFreeSubscriptionPeriodRecord {
  periodEnd: Date;
  periodStart: Date;
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
    console.info(`${LOG_PREFIX} ${reason} (cancelled)`);
    return true;
  }

  if (!hasTimeRemaining(options.deadlineMs)) {
    console.info(`${LOG_PREFIX} ${reason} (deadline)`);
    return true;
  }

  return false;
}

function buildLocalFreeSubscriptionPeriodKey(
  record: LocalFreeSubscriptionPeriodRecord,
): string {
  return `${record.referenceId}:${record.periodStart.toISOString()}:${record.periodEnd.toISOString()}`;
}

function getNextLocalFreeSubscriptionPeriod(
  subscription: LocalFreeSubscriptionRecord,
): LocalFreeSubscriptionPeriodRecord | null {
  if (!subscription.periodEnd) {
    return null;
  }

  const periodStart = new Date(subscription.periodEnd.getTime());

  return {
    periodEnd: getNextMonthlyPeriodEnd(periodStart, subscription.createdAt),
    periodStart,
    referenceId: subscription.referenceId,
  };
}

async function filterSubscriptionsMissingNextLocalSuccessor(
  subscriptions: LocalFreeSubscriptionRecord[],
): Promise<LocalFreeSubscriptionRecord[]> {
  const successorPeriods = new Map<string, LocalFreeSubscriptionPeriodRecord>();

  for (const subscription of subscriptions) {
    const nextPeriod = getNextLocalFreeSubscriptionPeriod(subscription);

    if (!nextPeriod) {
      continue;
    }

    successorPeriods.set(
      buildLocalFreeSubscriptionPeriodKey(nextPeriod),
      nextPeriod,
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
      buildLocalFreeSubscriptionPeriodKey(nextPeriod),
    );
  });
}

async function renewLocalFreeSubscriptionPeriod(
  subscription: LocalFreeSubscriptionRecord,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await transitionToNextLocalFreeSubscriptionPeriod(
      {
        setCanceledAt: false,
        subscription,
      },
      tx,
    );
  });
}

async function renewLocalFreeSubscriptions(
  options: SyncExecutionOptions,
): Promise<FreeSubscriptionRenewalSyncResult> {
  const attemptedSubscriptionIds = new Set<string>();
  let renewalErrors = 0;
  let renewed = 0;
  let stoppedEarly = false;

  while (true) {
    if (
      shouldStopSync(
        options,
        "Stopping before querying more local free subscriptions for renewal",
      )
    ) {
      stoppedEarly = true;
      return { renewalErrors, renewed, stoppedEarly };
    }

    const dueLocalFreeSubscriptions = (await prisma.subscription.findMany({
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
        canceledAt: true,
        createdAt: true,
        endedAt: true,
        id: true,
        periodEnd: true,
        referenceId: true,
        seats: true,
        stripeCustomerId: true,
        stripeSubscriptionId: true,
      },
    })) as LocalFreeSubscriptionRecord[];

    const subscriptionsNeedingRenewal =
      await filterSubscriptionsMissingNextLocalSuccessor(
        dueLocalFreeSubscriptions.filter(
          (subscription) => !attemptedSubscriptionIds.has(subscription.id),
        ),
      );

    if (subscriptionsNeedingRenewal.length === 0) {
      return { renewalErrors, renewed, stoppedEarly };
    }

    for (const subscription of subscriptionsNeedingRenewal) {
      if (
        shouldStopSync(
          options,
          "Stopping before renewing more local free subscriptions",
        )
      ) {
        stoppedEarly = true;
        return { renewalErrors, renewed, stoppedEarly };
      }

      attemptedSubscriptionIds.add(subscription.id);

      try {
        await renewLocalFreeSubscriptionPeriod(subscription);
        renewed += 1;
      } catch (error) {
        renewalErrors += 1;
        console.error(
          `${LOG_PREFIX} Failed to renew local free subscription ${subscription.id}:`,
          error,
        );
      }
    }
  }
}

export const freeSubscriptionSyncService = {
  async renewLocalFreeSubscriptions(
    options: SyncExecutionOptions,
  ): Promise<FreeSubscriptionRenewalSyncResult> {
    return await renewLocalFreeSubscriptions(options);
  },
};
