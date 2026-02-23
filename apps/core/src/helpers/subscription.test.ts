import {
  CreditBucketReferenceType,
  type Prisma,
} from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/database/helpers";
import { describe, expect, it, vi } from "vitest";

import {
  getCurrentSubscriptionCredits,
  mapSubscription,
} from "./subscription";

function createSubscriptionRecord(
  overrides: Partial<{
    cancelAtPeriodEnd: boolean | null;
    credits: { remaining: number; total: number; used: number } | null;
    id: string;
    periodEnd: Date | null;
    periodStart: Date | null;
    plan: string;
    status: string;
  }> = {},
) {
  return {
    id: "sub_123",
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
  totalCents?: bigint | null;
  usedCents?: bigint | null;
}): {
  aggregateBuckets: ReturnType<typeof vi.fn>;
  aggregateConsumptions: ReturnType<typeof vi.fn>;
  tx: Prisma.TransactionClient;
} {
  const aggregateBuckets = vi.fn().mockResolvedValue({
    _sum: { amount: params?.totalCents ?? null },
  });
  const aggregateConsumptions = vi.fn().mockResolvedValue({
    _sum: { amount: params?.usedCents ?? null },
  });

  return {
    aggregateBuckets,
    aggregateConsumptions,
    tx: {
      creditBucket: {
        aggregate: aggregateBuckets,
      },
      creditConsumption: {
        aggregate: aggregateConsumptions,
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
        id: "sub_123",
        plan: "starter",
        status: "active",
        periodStart,
        periodEnd,
        cancelAtPeriodEnd: false,
        credits: { total: 100, used: 42.5, remaining: 57.5 },
      }),
    ).toEqual({
      id: "sub_123",
      plan: "starter",
      status: "active",
      periodStart,
      periodEnd,
      cancelAtPeriodEnd: false,
      credits: { total: 100, used: 42.5, remaining: 57.5 },
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
      expiresAt: periodEnd,
      createdAt: {
        gte: periodStart,
        lt: periodEnd,
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
      expiresAt: periodEnd,
      createdAt: {
        gte: periodStart,
        lt: periodEnd,
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
});
