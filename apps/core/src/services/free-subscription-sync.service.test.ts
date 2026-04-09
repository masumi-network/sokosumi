import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  subscriptionFindManyMock,
  transitionToNextLocalFreeSubscriptionPeriodMock,
} = vi.hoisted(() => ({
  subscriptionFindManyMock: vi.fn(),
  transitionToNextLocalFreeSubscriptionPeriodMock: vi.fn(),
}));

vi.mock("@sokosumi/database/helpers", () => ({
  ACTIVE_SUBSCRIPTION_STATUSES: ["active", "trialing", "past_due", "unpaid"],
  FREE_SUBSCRIPTION_PLAN: "free",
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

describe("freeSubscriptionSyncService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"));
    vi.resetAllMocks();
    transitionToNextLocalFreeSubscriptionPeriodMock.mockResolvedValue(
      undefined,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renews due local free subscriptions exactly once per overdue period", async () => {
    subscriptionFindManyMock.mockImplementation(
      ({ where }: { where: { OR?: unknown[] } }) => {
        if (where.OR) {
          return Promise.resolve([]);
        }

        return Promise.resolve([
          {
            canceledAt: null,
            createdAt: new Date("2026-03-15T00:00:00.000Z"),
            endedAt: null,
            id: "sub-local-1",
            periodEnd: new Date("2026-04-15T00:00:00.000Z"),
            referenceId: "org-1",
            stripeCustomerId: "cus_1",
            stripeSubscriptionId: null,
          },
        ]);
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
        subscription: {
          canceledAt: null,
          createdAt: new Date("2026-03-15T00:00:00.000Z"),
          endedAt: null,
          id: "sub-local-1",
          periodEnd: new Date("2026-04-15T00:00:00.000Z"),
          referenceId: "org-1",
          stripeCustomerId: "cus_1",
          stripeSubscriptionId: null,
        },
      },
      expect.anything(),
    );
  });

  it("skips renewal when the next local free successor already exists", async () => {
    subscriptionFindManyMock.mockImplementation(
      ({ where }: { where: { OR?: Array<{ referenceId: string }> } }) => {
        if (where.OR) {
          return Promise.resolve([
            {
              periodEnd: new Date("2026-05-15T00:00:00.000Z"),
              periodStart: new Date("2026-04-15T00:00:00.000Z"),
              referenceId: "user-1",
            },
          ]);
        }

        return Promise.resolve([
          {
            canceledAt: null,
            createdAt: new Date("2026-03-15T00:00:00.000Z"),
            endedAt: null,
            id: "sub-local-1",
            periodEnd: new Date("2026-04-15T00:00:00.000Z"),
            referenceId: "user-1",
            stripeCustomerId: "cus_1",
            stripeSubscriptionId: null,
          },
        ]);
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
    ).not.toHaveBeenCalled();
  });

  it("catches up multiple overdue local free subscriptions in one run", async () => {
    subscriptionFindManyMock.mockImplementation(
      ({ where }: { where: { OR?: unknown[] } }) => {
        if (where.OR) {
          return Promise.resolve([]);
        }

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
