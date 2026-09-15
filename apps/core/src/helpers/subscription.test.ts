import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCreditsPayload,
  getCreditSummary,
  getCurrentSubscriptionCredits,
  mapSubscription,
} from "./subscription";

const getCreditsMock = vi.fn();

const {
  resolveActiveSubscriptionByReferenceIdMock,
  getLatestSubscriptionByReferenceIdMock,
  listAvailableBucketsWithBalancesMock,
  listEnterprisePoolBucketsWithBalancesMock,
} = vi.hoisted(() => ({
  resolveActiveSubscriptionByReferenceIdMock: vi.fn(),
  getLatestSubscriptionByReferenceIdMock: vi.fn(),
  listAvailableBucketsWithBalancesMock: vi.fn(),
  listEnterprisePoolBucketsWithBalancesMock: vi.fn(),
}));

vi.mock("@/helpers/user", () => ({
  getCredits: (...args: unknown[]) => getCreditsMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  subscriptionRepository: {
    resolveActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      resolveActiveSubscriptionByReferenceIdMock(...args),
    getLatestSubscriptionByReferenceId: (...args: unknown[]) =>
      getLatestSubscriptionByReferenceIdMock(...args),
  },
  creditBucketRepository: {
    listAvailableBucketsWithBalances: (...args: unknown[]) =>
      listAvailableBucketsWithBalancesMock(...args),
    listEnterprisePoolBucketsWithBalances: (...args: unknown[]) =>
      listEnterprisePoolBucketsWithBalancesMock(...args),
  },
}));

function createSubscriptionRecord(
  overrides: Partial<{
    cancelAtPeriodEnd: boolean | null;
    credits: { remaining: number; total: number; used: number } | null;
    periodEnd: Date | null;
    periodStart: Date | null;
    plan: string;
    status: string;
  }> = {},
) {
  return {
    plan: "starter",
    status: "active",
    periodStart: new Date("2025-01-01T00:00:00.000Z"),
    periodEnd: new Date("2025-02-01T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    credits: null,
    ...overrides,
  };
}

interface PeriodBucketFixture {
  amountCents: bigint;
  id: string;
  lifetimeUsedCents: bigint;
  periodUsedCents: bigint;
}

function createTransactionClient(params?: {
  buckets?: PeriodBucketFixture[];
  totalCents?: bigint | null;
  usedCents?: bigint | null;
}): {
  findManyBuckets: ReturnType<typeof vi.fn>;
  groupByConsumptions: ReturnType<typeof vi.fn>;
  tx: Prisma.TransactionClient;
} {
  const buckets: PeriodBucketFixture[] =
    params?.buckets ??
    (params?.totalCents != null && params.totalCents > 0n
      ? [
          {
            amountCents: params.totalCents,
            id: "bucket_1",
            lifetimeUsedCents: params.usedCents ?? 0n,
            periodUsedCents: params.usedCents ?? 0n,
          },
        ]
      : []);

  const findManyBuckets = vi.fn().mockResolvedValue(
    buckets.map((bucket) => ({
      amount: bucket.amountCents,
      id: bucket.id,
    })),
  );
  const groupByConsumptions = vi
    .fn()
    .mockImplementation(async (args: { where?: { createdAt?: unknown } }) => {
      const periodOnly = args.where?.createdAt != null;
      return buckets.map((bucket) => ({
        _sum: {
          amount: periodOnly
            ? bucket.periodUsedCents
            : bucket.lifetimeUsedCents,
        },
        bucketId: bucket.id,
      }));
    });

  return {
    findManyBuckets,
    groupByConsumptions,
    tx: {
      creditBucket: {
        findMany: findManyBuckets,
      },
      creditConsumption: {
        groupBy: groupByConsumptions,
      },
    } as unknown as Prisma.TransactionClient,
  };
}

function currentPeriodBucketWhere(now: Date, scope: Record<string, unknown>) {
  return {
    AND: [
      { OR: [{ activatesAt: null }, { activatesAt: { lte: now } }] },
      scope,
      {
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    ],
  };
}

describe("mapSubscription", () => {
  it("returns null when subscription does not exist", () => {
    expect(mapSubscription(null)).toBeNull();
  });

  it("maps subscription fields", () => {
    const periodStart = new Date("2025-01-01T00:00:00.000Z");
    const periodEnd = new Date("2025-02-01T00:00:00.000Z");

    expect(
      mapSubscription({
        plan: "starter",
        status: "active",
        periodStart,
        periodEnd,
        cancelAtPeriodEnd: false,
        credits: { total: 100, used: 42.5, remaining: 57.5 },
      }),
    ).toEqual({
      plan: "starter",
      status: "active",
      periodStart,
      periodEnd,
      cancelAtPeriodEnd: false,
      credits: { total: 100, used: 42.5, remaining: 57.5 },
    });
  });
});

describe("getCreditSummary", () => {
  it("returns buffer and total when subscription credits are present", () => {
    expect(
      getCreditSummary({
        totalCredits: 30,
        subscriptionCredits: {
          remaining: 12,
        },
      }),
    ).toEqual({
      buffer: 18,
      total: 30,
    });
  });

  it("returns full total in buffer when no subscription credits are present", () => {
    expect(
      getCreditSummary({
        totalCredits: 11,
        subscriptionCredits: null,
      }),
    ).toEqual({
      buffer: 11,
      total: 11,
    });
  });

  it("clamps buffer at zero and total at totalCredits when subscription remaining exceeds total", () => {
    expect(
      getCreditSummary({
        totalCredits: 5,
        subscriptionCredits: {
          remaining: 8,
        },
      }),
    ).toEqual({
      buffer: 0,
      total: 5,
    });
  });
});

describe("getCurrentSubscriptionCredits", () => {
  it("returns null when subscription does not exist", async () => {
    const { findManyBuckets, groupByConsumptions, tx } =
      createTransactionClient({
        totalCents: convertCreditsToCents(10),
        usedCents: convertCreditsToCents(3),
      });

    await expect(
      getCurrentSubscriptionCredits({
        subscription: null,
        userId: "user_1",
        organizationId: null,
        tx,
      }),
    ).resolves.toBeNull();

    expect(findManyBuckets).not.toHaveBeenCalled();
    expect(groupByConsumptions).not.toHaveBeenCalled();
  });

  it("returns null when period start is missing", async () => {
    const { findManyBuckets, groupByConsumptions, tx } =
      createTransactionClient({
        totalCents: convertCreditsToCents(10),
        usedCents: convertCreditsToCents(3),
      });

    await expect(
      getCurrentSubscriptionCredits({
        subscription: createSubscriptionRecord({ periodStart: null }),
        userId: "user_1",
        organizationId: null,
        tx,
      }),
    ).resolves.toBeNull();

    expect(findManyBuckets).not.toHaveBeenCalled();
    expect(groupByConsumptions).not.toHaveBeenCalled();
  });

  it("returns null when period end is missing", async () => {
    const { findManyBuckets, groupByConsumptions, tx } =
      createTransactionClient({
        totalCents: convertCreditsToCents(10),
        usedCents: convertCreditsToCents(3),
      });

    await expect(
      getCurrentSubscriptionCredits({
        subscription: createSubscriptionRecord({ periodEnd: null }),
        userId: "user_1",
        organizationId: null,
        tx,
      }),
    ).resolves.toBeNull();

    expect(findManyBuckets).not.toHaveBeenCalled();
    expect(groupByConsumptions).not.toHaveBeenCalled();
  });

  it("returns null when subscription period is not current", async () => {
    const now = new Date("2025-01-15T12:00:00.000Z");
    const { findManyBuckets, groupByConsumptions, tx } =
      createTransactionClient({
        totalCents: convertCreditsToCents(10),
        usedCents: convertCreditsToCents(3),
      });

    await expect(
      getCurrentSubscriptionCredits({
        subscription: createSubscriptionRecord({
          periodStart: new Date("2025-02-01T00:00:00.000Z"),
          periodEnd: new Date("2025-03-01T00:00:00.000Z"),
        }),
        userId: "user_1",
        organizationId: null,
        tx,
        now,
      }),
    ).resolves.toBeNull();

    await expect(
      getCurrentSubscriptionCredits({
        subscription: createSubscriptionRecord({
          periodStart: new Date("2024-12-01T00:00:00.000Z"),
          periodEnd: new Date("2025-01-10T00:00:00.000Z"),
        }),
        userId: "user_1",
        organizationId: null,
        tx,
        now,
      }),
    ).resolves.toBeNull();

    expect(findManyBuckets).not.toHaveBeenCalled();
    expect(groupByConsumptions).not.toHaveBeenCalled();
  });

  it("aggregates personal subscription credits for current period", async () => {
    const now = new Date("2025-01-15T12:00:00.000Z");
    const periodStart = new Date("2025-01-01T00:00:00.000Z");
    const periodEnd = new Date("2025-02-01T00:00:00.000Z");
    const { findManyBuckets, groupByConsumptions, tx } =
      createTransactionClient({
        totalCents: convertCreditsToCents(10),
        usedCents: convertCreditsToCents(3),
      });

    await expect(
      getCurrentSubscriptionCredits({
        subscription: createSubscriptionRecord({ periodStart, periodEnd }),
        userId: "user_1",
        organizationId: null,
        tx,
        now,
      }),
    ).resolves.toEqual({
      total: 10,
      used: 3,
      remaining: 7,
    });

    const bucketWhere = currentPeriodBucketWhere(now, {
      referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
      userId: "user_1",
      organizationId: null,
      expiresAt: {
        gt: periodStart,
        lte: periodEnd,
      },
      createdAt: {
        lt: now,
      },
    });

    expect(findManyBuckets).toHaveBeenCalledWith({
      select: {
        amount: true,
        id: true,
      },
      where: bucketWhere,
    });
    expect(groupByConsumptions).toHaveBeenCalledTimes(2);
    expect(groupByConsumptions).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["bucketId"],
        where: {
          bucketId: { in: ["bucket_1"] },
          createdAt: {
            gte: periodStart,
            lt: now,
          },
        },
      }),
    );
  });

  it("aggregates organization subscription credits for current period", async () => {
    const now = new Date("2025-01-15T12:00:00.000Z");
    const periodStart = new Date("2025-01-01T00:00:00.000Z");
    const periodEnd = new Date("2025-02-01T00:00:00.000Z");
    const { findManyBuckets, groupByConsumptions, tx } =
      createTransactionClient({
        totalCents: convertCreditsToCents(20),
        usedCents: convertCreditsToCents(11),
      });

    await expect(
      getCurrentSubscriptionCredits({
        subscription: createSubscriptionRecord({ periodStart, periodEnd }),
        userId: "user_1",
        organizationId: "org_1",
        tx,
        now,
      }),
    ).resolves.toEqual({
      total: 20,
      used: 11,
      remaining: 9,
    });

    expect(findManyBuckets).toHaveBeenCalledWith({
      select: {
        amount: true,
        id: true,
      },
      where: currentPeriodBucketWhere(now, {
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        organizationId: "org_1",
        userId: null,
        expiresAt: {
          gt: periodStart,
          lte: periodEnd,
        },
        createdAt: {
          lt: now,
        },
      }),
    });
    expect(groupByConsumptions).toHaveBeenCalledTimes(2);
  });

  it("does not count leftover migrated period tombstones in the monthly bar", async () => {
    const now = new Date("2026-09-15T12:00:00.000Z");
    const { tx } = createTransactionClient({
      buckets: [
        {
          amountCents: convertCreditsToCents(1500),
          id: "live_grant",
          lifetimeUsedCents: 0n,
          periodUsedCents: 0n,
        },
        {
          amountCents: convertCreditsToCents(750),
          id: "migrated_tombstone",
          lifetimeUsedCents: convertCreditsToCents(750),
          periodUsedCents: 0n,
        },
      ],
    });

    await expect(
      getCurrentSubscriptionCredits({
        now,
        organizationId: "org_1",
        subscription: createSubscriptionRecord({
          periodEnd: new Date("2026-10-14T11:10:33.000Z"),
          periodStart: new Date("2026-09-14T11:10:33.000Z"),
        }),
        tx,
        userId: "user_1",
      }),
    ).resolves.toEqual({
      remaining: 1500,
      total: 1500,
      used: 0,
    });
  });

  it("keeps this-period usage on the live grant and still ignores empty leftovers", async () => {
    const { tx } = createTransactionClient({
      buckets: [
        {
          amountCents: convertCreditsToCents(1500),
          id: "live_grant",
          lifetimeUsedCents: convertCreditsToCents(736.45),
          periodUsedCents: convertCreditsToCents(736.45),
        },
        {
          amountCents: convertCreditsToCents(750),
          id: "migrated_tombstone",
          lifetimeUsedCents: convertCreditsToCents(750),
          periodUsedCents: 0n,
        },
      ],
    });

    await expect(
      getCurrentSubscriptionCredits({
        now: new Date("2025-01-15T12:00:00.000Z"),
        organizationId: "org_1",
        subscription: createSubscriptionRecord(),
        tx,
        userId: "user_1",
      }),
    ).resolves.toEqual({
      remaining: 763.55,
      total: 1500,
      used: 736.45,
    });
  });

  it("returns zero usage and remaining equals total when no consumptions exist", async () => {
    const now = new Date("2025-01-15T12:00:00.000Z");
    const { tx } = createTransactionClient({
      totalCents: convertCreditsToCents(9),
      usedCents: null,
    });

    await expect(
      getCurrentSubscriptionCredits({
        subscription: createSubscriptionRecord(),
        userId: "user_1",
        organizationId: null,
        tx,
        now,
      }),
    ).resolves.toEqual({
      total: 9,
      used: 0,
      remaining: 9,
    });
  });

  it("caps used at total so used plus remaining always equals total", async () => {
    const now = new Date("2025-01-15T12:00:00.000Z");
    const { tx } = createTransactionClient({
      totalCents: convertCreditsToCents(9),
      usedCents: convertCreditsToCents(12),
    });

    await expect(
      getCurrentSubscriptionCredits({
        subscription: createSubscriptionRecord(),
        userId: "user_1",
        organizationId: null,
        tx,
        now,
      }),
    ).resolves.toEqual({
      total: 9,
      used: 9,
      remaining: 0,
    });
  });

  it("does not constrain bucket creation to period start", async () => {
    const now = new Date("2025-01-15T12:00:00.000Z");
    const periodStart = new Date("2025-01-01T00:00:00.000Z");
    const periodEnd = new Date("2025-02-01T00:00:00.000Z");
    const { findManyBuckets, tx } = createTransactionClient({
      totalCents: convertCreditsToCents(10),
      usedCents: convertCreditsToCents(3),
    });

    await getCurrentSubscriptionCredits({
      subscription: createSubscriptionRecord({ periodStart, periodEnd }),
      userId: "user_1",
      organizationId: null,
      tx,
      now,
    });

    expect(findManyBuckets).toHaveBeenCalledWith({
      select: {
        amount: true,
        id: true,
      },
      where: {
        AND: [
          { OR: [{ activatesAt: null }, { activatesAt: { lte: now } }] },
          expect.objectContaining({
            createdAt: {
              lt: now,
            },
          }),
          {
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        ],
      },
    });
  });
});

describe("buildCreditsPayload", () => {
  beforeEach(() => {
    resolveActiveSubscriptionByReferenceIdMock.mockReset();
    getLatestSubscriptionByReferenceIdMock.mockReset();
    listAvailableBucketsWithBalancesMock.mockReset();
    listEnterprisePoolBucketsWithBalancesMock.mockReset();
    listAvailableBucketsWithBalancesMock.mockResolvedValue([]);
    listEnterprisePoolBucketsWithBalancesMock.mockResolvedValue([]);
  });

  it("uses the latest active subscription when one exists", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2025-01-15T12:00:00.000Z"));

      getCreditsMock.mockResolvedValue(25);
      const periodStart = new Date("2025-01-01T00:00:00.000Z");
      const periodEnd = new Date("2025-02-01T00:00:00.000Z");
      const activeSubscription = createSubscriptionRecord({
        periodEnd,
        periodStart,
      });
      resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(
        activeSubscription,
      );

      const { findManyBuckets, groupByConsumptions, tx } =
        createTransactionClient({
          totalCents: convertCreditsToCents(10),
          usedCents: convertCreditsToCents(4),
        });

      listAvailableBucketsWithBalancesMock.mockResolvedValue([
        {
          totalCents: convertCreditsToCents(19),
          remainingCents: convertCreditsToCents(19),
          expiresAt: null,
        },
      ]);

      await expect(
        buildCreditsPayload({
          userId: "user_1",
          organizationId: null,
          referenceId: "user_1",
          tx,
        }),
      ).resolves.toEqual({
        subscription: {
          cancelAtPeriodEnd: false,
          credits: {
            remaining: 6,
            total: 10,
            used: 4,
          },
          periodEnd,
          periodStart,
          plan: "starter",
          status: "active",
        },
        extra: {
          credits: {
            total: 19,
            remaining: 19,
            used: 0,
          },
          buckets: [
            {
              total: 19,
              remaining: 19,
              expiresAt: null,
            },
          ],
          enterprise: null,
        },
        credits: {
          buffer: 19,
          subscription: {
            cancelAtPeriodEnd: false,
            credits: {
              remaining: 6,
              total: 10,
              used: 4,
            },
            periodEnd,
            periodStart,
            plan: "starter",
            status: "active",
          },
          total: 25,
        },
      });

      expect(listAvailableBucketsWithBalancesMock).toHaveBeenCalledWith(
        "user_1",
        null,
        tx,
      );

      expect(resolveActiveSubscriptionByReferenceIdMock).toHaveBeenCalledWith(
        "user_1",
        tx,
      );
      expect(getLatestSubscriptionByReferenceIdMock).not.toHaveBeenCalled();
      expect(findManyBuckets).toHaveBeenCalledTimes(1);
      expect(groupByConsumptions).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the latest subscription when none are active (e.g. Stripe ended before local successor exists)", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2025-01-15T12:00:00.000Z"));

      getCreditsMock.mockResolvedValue(25);
      const periodStart = new Date("2025-01-01T00:00:00.000Z");
      const periodEnd = new Date("2025-02-01T00:00:00.000Z");
      resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);
      getLatestSubscriptionByReferenceIdMock.mockResolvedValue(
        createSubscriptionRecord({
          periodEnd,
          periodStart,
          status: "canceled",
        }),
      );

      const { findManyBuckets, groupByConsumptions, tx } =
        createTransactionClient({
          totalCents: convertCreditsToCents(10),
          usedCents: convertCreditsToCents(4),
        });

      listAvailableBucketsWithBalancesMock.mockResolvedValue([
        {
          totalCents: convertCreditsToCents(19),
          remainingCents: convertCreditsToCents(19),
          expiresAt: null,
        },
      ]);

      await expect(
        buildCreditsPayload({
          userId: "user_1",
          organizationId: null,
          referenceId: "user_1",
          tx,
        }),
      ).resolves.toEqual({
        subscription: {
          cancelAtPeriodEnd: false,
          credits: {
            remaining: 6,
            total: 10,
            used: 4,
          },
          periodEnd,
          periodStart,
          plan: "starter",
          status: "canceled",
        },
        extra: {
          credits: {
            total: 19,
            remaining: 19,
            used: 0,
          },
          buckets: [
            {
              total: 19,
              remaining: 19,
              expiresAt: null,
            },
          ],
          enterprise: null,
        },
        credits: {
          buffer: 19,
          subscription: {
            cancelAtPeriodEnd: false,
            credits: {
              remaining: 6,
              total: 10,
              used: 4,
            },
            periodEnd,
            periodStart,
            plan: "starter",
            status: "canceled",
          },
          total: 25,
        },
      });

      expect(listAvailableBucketsWithBalancesMock).toHaveBeenCalledWith(
        "user_1",
        null,
        tx,
      );

      expect(resolveActiveSubscriptionByReferenceIdMock).toHaveBeenCalledWith(
        "user_1",
        tx,
      );
      expect(getLatestSubscriptionByReferenceIdMock).toHaveBeenCalledWith(
        "user_1",
        tx,
      );
      expect(findManyBuckets).toHaveBeenCalledTimes(1);
      expect(groupByConsumptions).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps credit bucket rows into extra.buckets", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2025-01-15T12:00:00.000Z"));

      getCreditsMock.mockResolvedValue(10);
      resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);
      getLatestSubscriptionByReferenceIdMock.mockResolvedValue(null);

      const expiresAt = new Date("2026-03-01T00:00:00.000Z");
      listAvailableBucketsWithBalancesMock.mockResolvedValue([
        {
          totalCents: convertCreditsToCents(20),
          remainingCents: convertCreditsToCents(7.5),
          expiresAt,
        },
        {
          totalCents: convertCreditsToCents(5),
          remainingCents: convertCreditsToCents(5),
          expiresAt: null,
        },
      ]);

      const { tx } = createTransactionClient({
        totalCents: 0n,
        usedCents: 0n,
      });

      await expect(
        buildCreditsPayload({
          userId: "user_1",
          organizationId: "org_1",
          referenceId: "org_1",
          tx,
        }),
      ).resolves.toEqual({
        subscription: null,
        extra: {
          credits: {
            total: 25,
            remaining: 12.5,
            used: 12.5,
          },
          buckets: [
            { total: 20, remaining: 7.5, expiresAt },
            { total: 5, remaining: 5, expiresAt: null },
          ],
          enterprise: null,
        },
        credits: {
          buffer: 10,
          subscription: null,
          total: 10,
        },
      });

      expect(listAvailableBucketsWithBalancesMock).toHaveBeenCalledWith(
        "user_1",
        "org_1",
        tx,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("excludes enterprise pool remaining from credits.buffer", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2025-01-15T12:00:00.000Z"));

      getCreditsMock.mockResolvedValue(100);
      const periodStart = new Date("2025-01-01T00:00:00.000Z");
      const periodEnd = new Date("2025-02-01T00:00:00.000Z");
      resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(
        createSubscriptionRecord({
          periodEnd,
          periodStart,
        }),
      );

      const { tx } = createTransactionClient({
        totalCents: convertCreditsToCents(10),
        usedCents: convertCreditsToCents(4),
      });

      listAvailableBucketsWithBalancesMock.mockResolvedValue([
        {
          totalCents: convertCreditsToCents(20),
          remainingCents: convertCreditsToCents(15),
          expiresAt: null,
        },
      ]);
      listEnterprisePoolBucketsWithBalancesMock.mockResolvedValue([
        {
          totalCents: convertCreditsToCents(50),
          remainingCents: convertCreditsToCents(30),
          expiresAt: null,
        },
      ]);

      const payload = await buildCreditsPayload({
        userId: "user_1",
        organizationId: "org_1",
        referenceId: "org_1",
        tx,
      });

      expect(payload.extra.enterprise).toEqual({
        credits: {
          total: 50,
          remaining: 30,
          used: 20,
        },
        buckets: [
          {
            total: 50,
            remaining: 30,
            expiresAt: null,
          },
        ],
      });
      expect(payload.credits.buffer).toBe(64);
      expect(payload.credits.total).toBe(100);
    } finally {
      vi.useRealTimers();
    }
  });
});
