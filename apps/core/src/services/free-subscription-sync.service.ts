import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  closeOverdueLocalFreeSubscription,
  ensureNextLocalFreeSubscriptionPeriod,
  FREE_SUBSCRIPTION_PLAN,
  FREE_SUBSCRIPTION_PRECREATE_LOOKAHEAD_MS,
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
  preCreated: number;
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

async function loadExistingSuccessorKeys(
  subscriptions: LocalFreeSubscriptionRecord[],
): Promise<Set<string>> {
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
    return new Set();
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

  return new Set(
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
}

function subscriptionHasNextLocalSuccessor(
  subscription: LocalFreeSubscriptionRecord,
  existingSuccessorKeys: Set<string>,
): boolean {
  const nextPeriod = getNextLocalFreeSubscriptionPeriod(subscription);

  if (!nextPeriod) {
    return false;
  }

  return existingSuccessorKeys.has(
    buildLocalFreeSubscriptionPeriodKey(nextPeriod),
  );
}

async function filterSubscriptionsMissingNextLocalSuccessor(
  subscriptions: LocalFreeSubscriptionRecord[],
): Promise<LocalFreeSubscriptionRecord[]> {
  const existingSuccessorKeys = await loadExistingSuccessorKeys(subscriptions);

  return subscriptions.filter((subscription) => {
    if (
      subscriptionHasNextLocalSuccessor(subscription, existingSuccessorKeys)
    ) {
      return false;
    }

    return getNextLocalFreeSubscriptionPeriod(subscription) !== null;
  });
}

const localFreeSubscriptionSelect = {
  canceledAt: true,
  createdAt: true,
  endedAt: true,
  id: true,
  periodEnd: true,
  referenceId: true,
  seats: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
} as const;

async function preCreateUpcomingLocalFreeSubscriptions(
  options: SyncExecutionOptions,
  attemptedSubscriptionIds: Set<string>,
): Promise<{ preCreated: number; stoppedEarly: boolean }> {
  let preCreated = 0;
  let stoppedEarly = false;
  const now = new Date();
  const lookaheadEnd = new Date(
    now.getTime() + FREE_SUBSCRIPTION_PRECREATE_LOOKAHEAD_MS,
  );
  const preCreateVisitedSubscriptionIds = new Set<string>();

  while (true) {
    if (
      shouldStopSync(
        options,
        "Stopping before querying more local free subscriptions for pre-create",
      )
    ) {
      stoppedEarly = true;
      return { preCreated, stoppedEarly };
    }

    const upcomingLocalFreeSubscriptions = (await prisma.subscription.findMany({
      where: {
        plan: FREE_SUBSCRIPTION_PLAN,
        periodEnd: {
          gt: now,
          lte: lookaheadEnd,
        },
        status: {
          in: [...ACTIVE_SUBSCRIPTION_STATUSES],
        },
        stripeSubscriptionId: null,
      },
      orderBy: [{ periodEnd: "asc" }, { updatedAt: "asc" }],
      select: localFreeSubscriptionSelect,
    })) as LocalFreeSubscriptionRecord[];

    const subscriptionsNeedingPreCreate =
      await filterSubscriptionsMissingNextLocalSuccessor(
        upcomingLocalFreeSubscriptions.filter(
          (subscription) =>
            !attemptedSubscriptionIds.has(subscription.id) &&
            !preCreateVisitedSubscriptionIds.has(subscription.id),
        ),
      );

    if (subscriptionsNeedingPreCreate.length === 0) {
      return { preCreated, stoppedEarly };
    }

    for (const subscription of subscriptionsNeedingPreCreate) {
      if (
        shouldStopSync(
          options,
          "Stopping before pre-creating more local free subscriptions",
        )
      ) {
        stoppedEarly = true;
        return { preCreated, stoppedEarly };
      }

      preCreateVisitedSubscriptionIds.add(subscription.id);

      const nextPeriod = getNextLocalFreeSubscriptionPeriod(subscription);
      if (!nextPeriod) {
        continue;
      }

      try {
        const ensured = await prisma.$transaction(async (tx) => {
          return ensureNextLocalFreeSubscriptionPeriod(
            {
              activatesAt: nextPeriod.periodStart,
              subscription,
            },
            tx,
          );
        });

        if (ensured) {
          preCreated += 1;
          attemptedSubscriptionIds.add(subscription.id);
        }
      } catch (error) {
        attemptedSubscriptionIds.add(subscription.id);
        console.error(
          `${LOG_PREFIX} Failed to pre-create local free subscription ${subscription.id}:`,
          error,
        );
      }
    }
  }
}

async function closeOverdueLocalFreeSubscriptions(
  options: SyncExecutionOptions,
  attemptedSubscriptionIds: Set<string>,
): Promise<{
  renewalErrors: number;
  renewed: number;
  stoppedEarly: boolean;
}> {
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
      select: localFreeSubscriptionSelect,
    })) as LocalFreeSubscriptionRecord[];

    const pendingOverdue = dueLocalFreeSubscriptions.filter(
      (subscription) => !attemptedSubscriptionIds.has(subscription.id),
    );

    if (pendingOverdue.length === 0) {
      return { renewalErrors, renewed, stoppedEarly };
    }

    const existingSuccessorKeys =
      await loadExistingSuccessorKeys(pendingOverdue);

    for (const subscription of pendingOverdue) {
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

      const hasExistingSuccessor = subscriptionHasNextLocalSuccessor(
        subscription,
        existingSuccessorKeys,
      );

      try {
        await prisma.$transaction(async (tx) => {
          if (hasExistingSuccessor) {
            await closeOverdueLocalFreeSubscription(
              {
                setCanceledAt: false,
                subscription,
              },
              tx,
            );
          } else {
            await transitionToNextLocalFreeSubscriptionPeriod(
              {
                setCanceledAt: false,
                subscription,
              },
              tx,
            );
          }
        });

        if (!hasExistingSuccessor) {
          renewed += 1;
        }
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

async function renewLocalFreeSubscriptions(
  options: SyncExecutionOptions,
): Promise<FreeSubscriptionRenewalSyncResult> {
  const attemptedSubscriptionIds = new Set<string>();

  const preCreateResult = await preCreateUpcomingLocalFreeSubscriptions(
    options,
    attemptedSubscriptionIds,
  );

  if (preCreateResult.stoppedEarly) {
    return {
      preCreated: preCreateResult.preCreated,
      renewalErrors: 0,
      renewed: 0,
      stoppedEarly: true,
    };
  }

  const overdueResult = await closeOverdueLocalFreeSubscriptions(
    options,
    attemptedSubscriptionIds,
  );

  return {
    preCreated: preCreateResult.preCreated,
    renewalErrors: overdueResult.renewalErrors,
    renewed: overdueResult.renewed,
    stoppedEarly: overdueResult.stoppedEarly,
  };
}

export const freeSubscriptionSyncService = {
  async renewLocalFreeSubscriptions(
    options: SyncExecutionOptions,
  ): Promise<FreeSubscriptionRenewalSyncResult> {
    return await renewLocalFreeSubscriptions(options);
  },
};
