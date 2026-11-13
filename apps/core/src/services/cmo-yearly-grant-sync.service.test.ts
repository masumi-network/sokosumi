import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { syncCmoYearlyGrants } from "./cmo-yearly-grant-sync.service";

/** Credits are stored as cents, base 10^10 (apps/core/AGENTS.md). */
const CENTS_PER_CREDIT = 10_000_000_000n;

const m = vi.hoisted(() => ({
  listPolarProducts: vi.fn(),
  captureMessage: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    cmoSubscription: { findMany: vi.fn() },
    creditBucket: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    transaction: { create: vi.fn() },
  },
}));

vi.mock("@/clients/polar.client", () => ({
  listPolarProducts: m.listPolarProducts,
}));
vi.mock("@/lib/db/prisma", () => ({ default: m.prisma }));
vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  captureMessage: m.captureMessage,
}));

const ORGANIZATION_ID = "org_1";
const PROJECT_ID = "0190a000-0000-7000-8000-000000000001";

function yearlyProduct(
  id: string,
  name: string,
  tier: string,
  credits: string,
) {
  return {
    id,
    name,
    is_recurring: true,
    recurring_interval: "year",
    recurring_interval_count: 1,
    metadata: { kind: "plan", tier, credits },
    prices: [
      {
        amount_type: "fixed",
        is_archived: false,
        price_amount: 100,
        price_currency: "usd",
      },
    ],
  };
}

/** A year paid on January 31st, so the short months show the day clamp. */
const SUBSCRIPTION = {
  id: "0190a000-0000-7000-8000-0000000000aa",
  projectId: PROJECT_ID,
  organizationId: ORGANIZATION_ID,
  polarProductId: "prod_growth_year",
  interval: "year",
  status: "active",
  currentPeriodStart: new Date("2026-01-31T10:00:00.000Z"),
  currentPeriodEnd: new Date("2027-01-31T10:00:00.000Z"),
  cancelAtPeriodEnd: false,
  lastPaidOrderId: "order_y1",
  lastPaidOrderRefundedAt: null,
  endedAt: null,
};

/** When month 1 to 11 of that year begin, then the year's end. */
const MONTH_STARTS = [
  "2026-02-28T10:00:00.000Z",
  "2026-03-31T10:00:00.000Z",
  "2026-04-30T10:00:00.000Z",
  "2026-05-31T10:00:00.000Z",
  "2026-06-30T10:00:00.000Z",
  "2026-07-31T10:00:00.000Z",
  "2026-08-31T10:00:00.000Z",
  "2026-09-30T10:00:00.000Z",
  "2026-10-31T10:00:00.000Z",
  "2026-11-30T10:00:00.000Z",
  "2026-12-31T10:00:00.000Z",
  "2027-01-31T10:00:00.000Z",
];

let subscriptions: (typeof SUBSCRIPTION | Record<string, unknown>)[];
/** The grants written so far, by the bucket's unique reference id. */
let buckets: Map<string, { amount: bigint; expiresAt: Date; note: string }>;

function matches(row: Record<string, unknown>, where: Record<string, unknown>) {
  return Object.entries(where).every(([field, condition]) => {
    const value = row[field];
    if (condition === null || typeof condition !== "object") {
      return value === condition;
    }
    if ("not" in condition) return value !== condition.not;
    if ("gt" in condition) return (value as Date) > (condition.gt as Date);
    throw new Error(`The fake does not know the filter on ${field}`);
  });
}

function sync() {
  return syncCmoYearlyGrants(() => true);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  subscriptions = [SUBSCRIPTION];
  buckets = new Map();
  m.listPolarProducts.mockResolvedValue([
    yearlyProduct("prod_starter_year", "Starter yearly", "starter", "10000"),
    yearlyProduct("prod_growth_year", "Growth yearly", "growth", "25000"),
  ]);
  m.prisma.$transaction.mockImplementation((run) => run(m.prisma));
  m.prisma.cmoSubscription.findMany.mockImplementation(async ({ where }) =>
    subscriptions.filter((row) => matches(row, where)),
  );
  m.prisma.creditBucket.findMany.mockImplementation(async ({ where }) =>
    where.referenceId.in
      .filter((referenceId: string) => buckets.has(referenceId))
      .map((referenceId: string) => ({ referenceId })),
  );
  m.prisma.task.findMany.mockResolvedValue([]);
  m.prisma.transaction.create.mockImplementation(async ({ data }) => {
    const bucket = data.sourceCreditBucket.create;
    if (buckets.has(bucket.referenceId)) {
      throw Object.assign(new Error("unique"), {
        code: "P2002",
        meta: { target: ["referenceId", "referenceType"] },
      });
    }
    buckets.set(bucket.referenceId, {
      amount: bucket.amount,
      expiresAt: bucket.expiresAt,
      note: bucket.referenceNote,
    });
    return { id: "tx_1" };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("syncCmoYearlyGrants", () => {
  it("grants the second month as Project credits once it has begun", async () => {
    vi.setSystemTime(new Date("2026-02-28T10:00:00.000Z"));

    const result = await sync();

    expect(result).toEqual({ errors: 0, granted: 1, stoppedEarly: false });
    expect(m.prisma.transaction.create).toHaveBeenCalledTimes(1);
    expect(m.prisma.transaction.create.mock.calls[0]?.[0].data).toEqual({
      amount: 25_000n * CENTS_PER_CREDIT,
      organizationId: ORGANIZATION_ID,
      userId: null,
      sourceCreditBucket: {
        create: {
          amount: 25_000n * CENTS_PER_CREDIT,
          expiresAt: new Date("2026-03-31T10:00:00.000Z"),
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          referenceId: "order_y1:1",
          referenceNote: "Growth yearly",
          referenceType: "CMO_SUBSCRIPTION_MONTH",
          userId: null,
        },
      },
    });
  });

  it("grants nothing while the first month runs: the paid order granted it", async () => {
    vi.setSystemTime(new Date("2026-02-28T09:59:59.000Z"));

    expect(await sync()).toEqual({
      errors: 0,
      granted: 0,
      stoppedEarly: false,
    });
    expect(buckets.size).toBe(0);
  });

  it("grants months 1 to 11 over the paid year, each expiring when the next begins", async () => {
    for (const monthStart of MONTH_STARTS.slice(0, 11)) {
      vi.setSystemTime(new Date(monthStart));
      await sync();
    }

    expect(
      [...buckets].map(([referenceId, bucket]) => [
        referenceId,
        bucket.expiresAt.toISOString(),
      ]),
    ).toEqual(
      MONTH_STARTS.slice(1).map((nextMonthStart, index) => [
        `order_y1:${index + 1}`,
        nextMonthStart,
      ]),
    );
    expect(
      [...buckets.values()].every(
        (bucket) => bucket.amount === 25_000n * CENTS_PER_CREDIT,
      ),
    ).toBe(true);
  });

  it("grants a month once however often it runs in that month", async () => {
    vi.setSystemTime(new Date("2026-03-31T10:00:00.000Z"));
    await sync();
    vi.setSystemTime(new Date("2026-04-15T00:00:00.000Z"));

    expect(await sync()).toEqual({
      errors: 0,
      granted: 0,
      stoppedEarly: false,
    });
    expect([...buckets.keys()]).toEqual(["order_y1:2"]);
    expect(m.prisma.transaction.create).toHaveBeenCalledTimes(1);
  });

  it("counts no grant when a concurrent run wrote the month first", async () => {
    vi.setSystemTime(new Date("2026-03-31T10:00:00.000Z"));
    m.prisma.transaction.create.mockRejectedValue(
      Object.assign(new Error("unique"), {
        code: "P2002",
        meta: { target: ["referenceId", "referenceType"] },
      }),
    );

    expect(await sync()).toEqual({
      errors: 0,
      granted: 0,
      stoppedEarly: false,
    });
  });

  it("grants nothing to a past-due subscription, and the running month once Polar collects", async () => {
    vi.setSystemTime(new Date("2026-06-30T10:00:00.000Z"));
    subscriptions = [{ ...SUBSCRIPTION, status: "past_due" }];

    await sync();
    expect(buckets.size).toBe(0);

    subscriptions = [SUBSCRIPTION];
    vi.setSystemTime(new Date("2026-08-02T00:00:00.000Z"));
    await sync();
    expect([...buckets.keys()]).toEqual(["order_y1:6"]);
  });

  it("grants nothing to an ended subscription", async () => {
    vi.setSystemTime(new Date("2026-06-30T10:00:00.000Z"));
    subscriptions = [
      {
        ...SUBSCRIPTION,
        status: "canceled",
        endedAt: new Date("2026-06-01T00:00:00.000Z"),
      },
    ];

    await sync();

    expect(buckets.size).toBe(0);
  });

  it("keeps granting to a subscription with a scheduled cancel until its paid year ends", async () => {
    subscriptions = [{ ...SUBSCRIPTION, cancelAtPeriodEnd: true }];

    for (const monthStart of MONTH_STARTS) {
      vi.setSystemTime(new Date(monthStart));
      await sync();
    }

    expect([...buckets.keys()]).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((index) => `order_y1:${index}`),
    );
  });

  it("grants the tier the subscription is on when the month begins", async () => {
    vi.setSystemTime(new Date("2026-02-28T10:00:00.000Z"));
    await sync();
    subscriptions = [{ ...SUBSCRIPTION, polarProductId: "prod_starter_year" }];
    vi.setSystemTime(new Date("2026-03-31T10:00:00.000Z"));
    await sync();

    expect(buckets.get("order_y1:1")).toMatchObject({
      amount: 25_000n * CENTS_PER_CREDIT,
      note: "Growth yearly",
    });
    expect(buckets.get("order_y1:2")).toMatchObject({
      amount: 10_000n * CENTS_PER_CREDIT,
      note: "Starter yearly",
    });
  });

  it("counts the next twelve months from the renewal order", async () => {
    subscriptions = [
      {
        ...SUBSCRIPTION,
        currentPeriodStart: new Date("2027-01-31T10:00:00.000Z"),
        currentPeriodEnd: new Date("2028-01-31T10:00:00.000Z"),
        lastPaidOrderId: "order_y2",
      },
    ];
    vi.setSystemTime(new Date("2027-01-31T10:00:00.000Z"));
    await sync();
    expect(buckets.size).toBe(0);

    vi.setSystemTime(new Date("2027-02-28T10:00:00.000Z"));
    await sync();

    expect([...buckets]).toEqual([
      [
        "order_y2:1",
        {
          amount: 25_000n * CENTS_PER_CREDIT,
          expiresAt: new Date("2027-03-31T10:00:00.000Z"),
          note: "Growth yearly",
        },
      ],
    ]);
  });

  it("leaves a monthly subscription to its orders", async () => {
    vi.setSystemTime(new Date("2026-06-30T10:00:00.000Z"));
    subscriptions = [{ ...SUBSCRIPTION, interval: "month" }];

    await sync();

    expect(buckets.size).toBe(0);
  });

  it("reports a subscription whose product is not a plan in the catalog and grants the others", async () => {
    vi.setSystemTime(new Date("2026-02-28T10:00:00.000Z"));
    subscriptions = [
      { ...SUBSCRIPTION, id: "sub_gone", polarProductId: "prod_gone" },
      { ...SUBSCRIPTION, lastPaidOrderId: "order_other" },
    ];

    expect(await sync()).toEqual({
      errors: 1,
      granted: 1,
      stoppedEarly: false,
    });
    expect(m.captureMessage).toHaveBeenCalledTimes(1);
    expect([...buckets.keys()]).toEqual(["order_other:1"]);
  });

  it("stops between grants when the run is told to", async () => {
    vi.setSystemTime(new Date("2026-02-28T10:00:00.000Z"));

    expect(await syncCmoYearlyGrants(() => false)).toEqual({
      errors: 0,
      granted: 0,
      stoppedEarly: true,
    });
  });
});
