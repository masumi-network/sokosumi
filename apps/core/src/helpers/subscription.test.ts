import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import {
  convertCreditsToCents,
  getOrganizationMemberSubscriptionReferencePrefixForStartsWith,
} from "@sokosumi/database/helpers";
import { describe, expect, it, vi } from "vitest";

import {
  buildCreditsPayload,
  getCreditSummary,
  getCurrentSubscriptionCredits,
  mapSubscription,
} from "./subscription";

const getCreditsMock = vi.fn();

vi.mock("@/helpers/user", () => ({
  getCredits: (...args: unknown[]) => getCreditsMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  subscriptionRepository: {
    getLatestActiveSubscriptionByReferenceId: (
      referenceId: string,
      tx: {
        subscription: {
          findFirst: (args: unknown) => Promise<unknown>;
        };
      },
    ) =>
      tx.subscription.findFirst({
        where: {
          referenceId,
          status: {
            in: ["active", "trialing", "past_due", "unpaid"],
          },
        },
        orderBy: [{ periodEnd: "desc" }, { updatedAt: "desc" }],
      }),
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

function createTransactionClient(params?: {
  latestSubscription?: null | ReturnType<typeof createSubscriptionRecord>;
  totalCents?: bigint | null;
  usedCents?: bigint | null;
}): {
  aggregateBuckets: ReturnType<typeof vi.fn>;
  aggregateConsumptions: ReturnType<typeof vi.fn>;
  findSubscription: ReturnType<typeof vi.fn>;
  tx: Prisma.TransactionClient;
} {
  const aggregateBuckets = vi.fn().mockResolvedValue({
    _sum: { amount: params?.totalCents ?? null },
  });
  const aggregateConsumptions = vi.fn().mockResolvedValue({
    _sum: { amount: params?.usedCents ?? null },
  });
  const findSubscription = vi
    .fn()
    .mockResolvedValue(params?.latestSubscription ?? null);

  return {
    aggregateBuckets,
    aggregateConsumptions,
    findSubscription,
    tx: {
      creditBucket: {
        aggregate: aggregateBuckets,
      },
      creditConsumption: {
        aggregate: aggregateConsumptions,
      },
      subscription: {
        findFirst: findSubscription,
      },
    } as unknown as Prisma.TransactionClient,
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
    const { aggregateBuckets, aggregateConsumptions, tx } =
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

    expect(aggregateBuckets).not.toHaveBeenCalled();
    expect(aggregateConsumptions).not.toHaveBeenCalled();
  });

  it("returns null when period start is missing", async () => {
    const { aggregateBuckets, aggregateConsumptions, tx } =
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

    expect(aggregateBuckets).not.toHaveBeenCalled();
    expect(aggregateConsumptions).not.toHaveBeenCalled();
  });

  it("returns null when period end is missing", async () => {
    const { aggregateBuckets, aggregateConsumptions, tx } =
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

    expect(aggregateBuckets).not.toHaveBeenCalled();
    expect(aggregateConsumptions).not.toHaveBeenCalled();
  });

  it("returns null when subscription period is not current", async () => {
    const now = new Date("2025-01-15T12:00:00.000Z");
    const { aggregateBuckets, aggregateConsumptions, tx } =
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

    expect(aggregateBuckets).not.toHaveBeenCalled();
    expect(aggregateConsumptions).not.toHaveBeenCalled();
  });

  it("aggregates personal subscription credits for current period", async () => {
    const now = new Date("2025-01-15T12:00:00.000Z");
    const periodStart = new Date("2025-01-01T00:00:00.000Z");
    const periodEnd = new Date("2025-02-01T00:00:00.000Z");
    const { aggregateBuckets, aggregateConsumptions, tx } =
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

    const bucketWhere = {
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
    };

    expect(aggregateBuckets).toHaveBeenCalledWith({
      _sum: {
        amount: true,
      },
      where: bucketWhere,
    });
    expect(aggregateConsumptions).toHaveBeenCalledWith({
      _sum: {
        amount: true,
      },
      where: {
        createdAt: {
          gte: periodStart,
          lt: now,
        },
        bucket: {
          is: bucketWhere,
        },
      },
    });
  });

  it("aggregates organization subscription credits for current period", async () => {
    const now = new Date("2025-01-15T12:00:00.000Z");
    const periodStart = new Date("2025-01-01T00:00:00.000Z");
    const periodEnd = new Date("2025-02-01T00:00:00.000Z");
    const { aggregateBuckets, aggregateConsumptions, tx } =
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

    const bucketWhere = {
      referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
      organizationId: "org_1",
      userId: "user_1",
      referenceId: {
        startsWith:
          getOrganizationMemberSubscriptionReferencePrefixForStartsWith(
            "user_1",
          ),
      },
      expiresAt: {
        gt: periodStart,
        lte: periodEnd,
      },
      createdAt: {
        lt: now,
      },
    };

    expect(aggregateBuckets).toHaveBeenCalledWith({
      _sum: {
        amount: true,
      },
      where: bucketWhere,
    });
    expect(aggregateConsumptions).toHaveBeenCalledWith({
      _sum: {
        amount: true,
      },
      where: {
        createdAt: {
          gte: periodStart,
          lt: now,
        },
        bucket: {
          is: bucketWhere,
        },
      },
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
    const { aggregateBuckets, tx } = createTransactionClient({
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

    expect(aggregateBuckets).toHaveBeenCalledWith({
      _sum: {
        amount: true,
      },
      where: expect.objectContaining({
        createdAt: {
          lt: now,
        },
      }),
    });
  });
});

describe("buildCreditsPayload", () => {
  it("uses the latest active subscription query when building credits payload", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2025-01-15T12:00:00.000Z"));

      getCreditsMock.mockResolvedValue(25);
      const periodStart = new Date("2025-01-01T00:00:00.000Z");
      const periodEnd = new Date("2025-02-01T00:00:00.000Z");
      const { aggregateBuckets, aggregateConsumptions, findSubscription, tx } =
        createTransactionClient({
          latestSubscription: createSubscriptionRecord({
            periodEnd,
            periodStart,
          }),
          totalCents: convertCreditsToCents(10),
          usedCents: convertCreditsToCents(4),
        });

      await expect(
        buildCreditsPayload({
          userId: "user_1",
          organizationId: null,
          referenceId: "user_1",
          tx,
        }),
      ).resolves.toEqual({
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
      });

      expect(findSubscription).toHaveBeenCalledWith({
        where: {
          referenceId: "user_1",
          status: {
            in: ["active", "trialing", "past_due", "unpaid"],
          },
        },
        orderBy: [{ periodEnd: "desc" }, { updatedAt: "desc" }],
      });
      expect(aggregateBuckets).toHaveBeenCalledTimes(1);
      expect(aggregateConsumptions).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
