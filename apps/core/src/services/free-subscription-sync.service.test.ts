import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  closeOverdueLocalFreeSubscriptionMock,
  ensureNextLocalFreeSubscriptionPeriodMock,
  subscriptionFindManyMock,
  transitionToNextLocalFreeSubscriptionPeriodMock,
} = vi.hoisted(() => ({
  closeOverdueLocalFreeSubscriptionMock: vi.fn(),
  ensureNextLocalFreeSubscriptionPeriodMock: vi.fn(),
  subscriptionFindManyMock: vi.fn(),
  transitionToNextLocalFreeSubscriptionPeriodMock: vi.fn(),
}));

vi.mock("@sokosumi/database/helpers", () => ({
  ACTIVE_SUBSCRIPTION_STATUSES: ["active", "trialing", "past_due", "unpaid"],
  FREE_SUBSCRIPTION_PLAN: "free",
  FREE_SUBSCRIPTION_PRECREATE_LOOKAHEAD_MS: 15 * 60 * 1000,
  getNextMonthlyPeriodEnd: (periodStart: Date, anchorDate: Date) => {
    const targetMonthIndex = periodStart.getUTCMonth() + 1;
    const targetYear =
      periodStart.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
    const targetMonth = targetMonthIndex % 12;
    const lastDayOfTargetMonth = new Date(
      Date.UTC(targetYear, targetMonth + 1, 0),
    ).getUTCDate();

    return new Date(
      Date.UTC(
        targetYear,
        targetMonth,
        Math.min(anchorDate.getUTCDate(), lastDayOfTargetMonth),
        periodStart.getUTCHours(),
        periodStart.getUTCMinutes(),
        periodStart.getUTCSeconds(),
        periodStart.getUTCMilliseconds(),
      ),
    );
  },
  ensureNextLocalFreeSubscriptionPeriod: (...args: unknown[]) =>
    ensureNextLocalFreeSubscriptionPeriodMock(...args),
  closeOverdueLocalFreeSubscription: (...args: unknown[]) =>
    closeOverdueLocalFreeSubscriptionMock(...args),
  transitionToNextLocalFreeSubscriptionPeriod: (...args: unknown[]) =>
    transitionToNextLocalFreeSubscriptionPeriodMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      await callback({ __tx: true }),
    subscription: {
      findMany: (...args: unknown[]) => subscriptionFindManyMock(...args),
    },
  },
}));

function createSyncExecutionOptions() {
  const deadlineMs = Date.now() + 60_000;

  return {
    deadlineMs,
    msRemaining: () => deadlineMs - Date.now(),
    shouldContinue: () => true,
  };
}

function isPreCreateQuery(where: {
  periodEnd?: { gt?: Date; lte?: Date };
}): boolean {
  return Boolean(where.periodEnd?.gt && where.periodEnd?.lte);
}

function isOverdueQuery(where: {
  periodEnd?: { gt?: Date; lte?: Date };
}): boolean {
  return Boolean(where.periodEnd?.lte && !where.periodEnd?.gt);
}

interface SubscriptionRenewalFindManyWhere {
  OR?: Array<{ referenceId: string }> | unknown[];
  periodEnd?: { gt?: Date; lte?: Date };
}

describe("freeSubscriptionSyncService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"));
    vi.resetAllMocks();
    ensureNextLocalFreeSubscriptionPeriodMock.mockResolvedValue(true);
    closeOverdueLocalFreeSubscriptionMock.mockResolvedValue(undefined);
    transitionToNextLocalFreeSubscriptionPeriodMock.mockResolvedValue(
      undefined,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pre-creates upcoming local free subscriptions within the lookahead window", async () => {
    subscriptionFindManyMock.mockImplementation(
      ({ where }: { where: SubscriptionRenewalFindManyWhere }) => {
        if (where.OR) {
          return Promise.resolve([]);
        }

        if (isPreCreateQuery(where)) {
          return Promise.resolve([
            {
              canceledAt: null,
              createdAt: new Date("2026-03-15T00:00:00.000Z"),
              endedAt: null,
              id: "sub-upcoming",
              periodEnd: new Date("2026-04-15T00:10:00.000Z"),
              referenceId: "user-1",
              seats: null,
              stripeCustomerId: "cus_1",
              stripeSubscriptionId: null,
            },
          ]);
        }

        if (isOverdueQuery(where)) {
          return Promise.resolve([]);
        }

        return Promise.resolve([]);
      },
    );

    const { freeSubscriptionSyncService } = await import(
      "./free-subscription-sync.service"
    );

    const result =
      await freeSubscriptionSyncService.renewLocalFreeSubscriptions(
        createSyncExecutionOptions(),
      );

    expect(result.preCreated).toBe(1);
    expect(result.renewed).toBe(0);
    expect(ensureNextLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
      {
        activatesAt: new Date("2026-04-15T00:10:00.000Z"),
        subscription: expect.objectContaining({ id: "sub-upcoming" }),
      },
      expect.anything(),
    );
    expect(
      transitionToNextLocalFreeSubscriptionPeriodMock,
    ).not.toHaveBeenCalled();
  });

  it("does not increment preCreated when ensureNextLocalFreeSubscriptionPeriod returns false", async () => {
    ensureNextLocalFreeSubscriptionPeriodMock.mockResolvedValue(false);
    subscriptionFindManyMock.mockImplementation(
      ({ where }: { where: SubscriptionRenewalFindManyWhere }) => {
        if (where.OR) {
          return Promise.resolve([]);
        }

        if (isPreCreateQuery(where)) {
          return Promise.resolve([
            {
              canceledAt: null,
              createdAt: new Date("2026-03-15T00:00:00.000Z"),
              endedAt: null,
              id: "sub-orphan",
              periodEnd: new Date("2026-04-15T00:10:00.000Z"),
              referenceId: "missing-user",
              seats: null,
              stripeCustomerId: "cus_1",
              stripeSubscriptionId: null,
            },
          ]);
        }

        if (isOverdueQuery(where)) {
          return Promise.resolve([]);
        }

        return Promise.resolve([]);
      },
    );

    const { freeSubscriptionSyncService } = await import(
      "./free-subscription-sync.service"
    );

    const result =
      await freeSubscriptionSyncService.renewLocalFreeSubscriptions(
        createSyncExecutionOptions(),
      );

    expect(result.preCreated).toBe(0);
    expect(ensureNextLocalFreeSubscriptionPeriodMock).toHaveBeenCalledTimes(1);
  });

  it("lets the overdue phase handle subscriptions when pre-create could not ensure a successor", async () => {
    ensureNextLocalFreeSubscriptionPeriodMock.mockResolvedValue(false);
    subscriptionFindManyMock.mockImplementation(
      ({ where }: { where: SubscriptionRenewalFindManyWhere }) => {
        if (where.OR) {
          return Promise.resolve([]);
        }

        if (isPreCreateQuery(where)) {
          return Promise.resolve([
            {
              canceledAt: null,
              createdAt: new Date("2026-03-15T00:00:00.000Z"),
              endedAt: null,
              id: "sub-orphan",
              periodEnd: new Date("2026-04-15T00:10:00.000Z"),
              referenceId: "missing-user",
              seats: null,
              stripeCustomerId: "cus_1",
              stripeSubscriptionId: null,
            },
          ]);
        }

        if (isOverdueQuery(where)) {
          return Promise.resolve([
            {
              canceledAt: null,
              createdAt: new Date("2026-03-15T00:00:00.000Z"),
              endedAt: null,
              id: "sub-orphan",
              periodEnd: new Date("2026-04-15T00:00:00.000Z"),
              referenceId: "missing-user",
              seats: null,
              stripeCustomerId: "cus_1",
              stripeSubscriptionId: null,
            },
          ]);
        }

        return Promise.resolve([]);
      },
    );

    const { freeSubscriptionSyncService } = await import(
      "./free-subscription-sync.service"
    );

    const result =
      await freeSubscriptionSyncService.renewLocalFreeSubscriptions(
        createSyncExecutionOptions(),
      );

    expect(result.preCreated).toBe(0);
    expect(result.renewed).toBe(1);
    expect(ensureNextLocalFreeSubscriptionPeriodMock).toHaveBeenCalledTimes(1);
    expect(
      transitionToNextLocalFreeSubscriptionPeriodMock,
    ).toHaveBeenCalledTimes(1);
    expect(
      transitionToNextLocalFreeSubscriptionPeriodMock,
    ).toHaveBeenCalledWith(
      {
        setCanceledAt: false,
        subscription: expect.objectContaining({ id: "sub-orphan" }),
      },
      expect.anything(),
    );
  });

  it("renews due local free subscriptions exactly once per overdue period", async () => {
    subscriptionFindManyMock.mockImplementation(
      ({ where }: { where: SubscriptionRenewalFindManyWhere }) => {
        if (where.OR) {
          return Promise.resolve([]);
        }

        if (isPreCreateQuery(where)) {
          return Promise.resolve([]);
        }

        if (isOverdueQuery(where)) {
          return Promise.resolve([
            {
              canceledAt: null,
              createdAt: new Date("2026-03-15T00:00:00.000Z"),
              endedAt: null,
              id: "sub-local-1",
              periodEnd: new Date("2026-04-15T00:00:00.000Z"),
              referenceId: "org-1",
              seats: null,
              stripeCustomerId: "cus_1",
              stripeSubscriptionId: null,
            },
          ]);
        }

        return Promise.resolve([]);
      },
    );

    const { freeSubscriptionSyncService } = await import(
      "./free-subscription-sync.service"
    );

    await freeSubscriptionSyncService.renewLocalFreeSubscriptions(
      createSyncExecutionOptions(),
    );

    expect(
      transitionToNextLocalFreeSubscriptionPeriodMock,
    ).toHaveBeenCalledTimes(1);
    expect(
      transitionToNextLocalFreeSubscriptionPeriodMock,
    ).toHaveBeenCalledWith(
      {
        setCanceledAt: false,
        subscription: expect.objectContaining({
          id: "sub-local-1",
          referenceId: "org-1",
        }),
      },
      expect.anything(),
    );
  });

  it("closes overdue subscription when the next local free successor already exists", async () => {
    subscriptionFindManyMock.mockImplementation(
      ({ where }: { where: SubscriptionRenewalFindManyWhere }) => {
        if (where.OR) {
          return Promise.resolve([
            {
              periodEnd: new Date("2026-05-15T00:00:00.000Z"),
              periodStart: new Date("2026-04-15T00:00:00.000Z"),
              referenceId: "user-1",
            },
          ]);
        }

        if (isPreCreateQuery(where)) {
          return Promise.resolve([]);
        }

        if (isOverdueQuery(where)) {
          return Promise.resolve([
            {
              canceledAt: null,
              createdAt: new Date("2026-03-15T00:00:00.000Z"),
              endedAt: null,
              id: "sub-local-1",
              periodEnd: new Date("2026-04-15T00:00:00.000Z"),
              referenceId: "user-1",
              seats: null,
              stripeCustomerId: "cus_1",
              stripeSubscriptionId: null,
            },
          ]);
        }

        return Promise.resolve([]);
      },
    );

    const { freeSubscriptionSyncService } = await import(
      "./free-subscription-sync.service"
    );

    const result =
      await freeSubscriptionSyncService.renewLocalFreeSubscriptions(
        createSyncExecutionOptions(),
      );

    expect(result.renewed).toBe(0);
    expect(closeOverdueLocalFreeSubscriptionMock).toHaveBeenCalledTimes(1);
    expect(
      transitionToNextLocalFreeSubscriptionPeriodMock,
    ).not.toHaveBeenCalled();
  });

  it("catches up multiple overdue local free subscriptions in one run", async () => {
    subscriptionFindManyMock.mockImplementation(
      ({ where }: { where: SubscriptionRenewalFindManyWhere }) => {
        if (where.OR) {
          return Promise.resolve([]);
        }

        if (isPreCreateQuery(where)) {
          return Promise.resolve([]);
        }

        if (isOverdueQuery(where)) {
          return Promise.resolve([
            {
              canceledAt: null,
              createdAt: new Date("2026-01-31T10:00:00.000Z"),
              endedAt: null,
              id: "sub-local-1",
              periodEnd: new Date("2026-02-28T10:00:00.000Z"),
              referenceId: "user-1",
              stripeCustomerId: "cus_1",
              stripeSubscriptionId: null,
            },
            {
              canceledAt: null,
              createdAt: new Date("2026-02-28T10:00:00.000Z"),
              endedAt: null,
              id: "sub-local-2",
              periodEnd: new Date("2026-03-31T10:00:00.000Z"),
              referenceId: "user-2",
              stripeCustomerId: "cus_2",
              stripeSubscriptionId: null,
            },
          ]);
        }

        return Promise.resolve([]);
      },
    );

    const { freeSubscriptionSyncService } = await import(
      "./free-subscription-sync.service"
    );

    await freeSubscriptionSyncService.renewLocalFreeSubscriptions(
      createSyncExecutionOptions(),
    );

    expect(
      transitionToNextLocalFreeSubscriptionPeriodMock,
    ).toHaveBeenCalledTimes(2);
  });
});
