import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import {
  CreditBucketReferenceType,
  EnterpriseContractPeriodStatus,
  EnterpriseContractStatus,
  type Prisma as PrismaType,
} from "../generated/prisma/client.js";
import {
  catchUpScheduledEnterprisePeriods,
  expireActiveEnterprisePeriodsWithElapsedBuckets,
  grantEnterpriseScheduledPeriod,
  preCreateUpcomingEnterprisePeriods,
  resolveCatchUpActivatesAt,
  runEnterpriseContractSchedulerPass,
} from "./enterprise-contract-scheduler.js";

const CENTS_PER_MONTH = 600_000_000_000_000n;
const ORG_ID = "org-1";
const PERIOD_ID = "01900000-0000-7000-8000-000000000201";
const OWNER_ID = "owner-1";

function createScheduledPeriod(overrides?: {
  id?: string;
  periodEnd?: Date;
  periodStart?: Date;
  status?: EnterpriseContractPeriodStatus;
}) {
  const now = new Date("2026-05-01T00:00:00.000Z");
  return {
    centsToGrant: CENTS_PER_MONTH,
    contract: {
      organizationId: ORG_ID,
    },
    contractId: "contract-1",
    createdAt: now,
    id: overrides?.id ?? PERIOD_ID,
    periodEnd: overrides?.periodEnd ?? new Date("2026-07-01T00:00:00.000Z"),
    periodStart: overrides?.periodStart ?? new Date("2026-06-01T00:00:00.000Z"),
    purchasedSeats: 10,
    status: overrides?.status ?? EnterpriseContractPeriodStatus.scheduled,
    updatedAt: now,
  };
}

function createGrantClient() {
  const findUniqueBucketMock = vi.fn().mockResolvedValue(null);
  const createTransactionMock = vi.fn().mockResolvedValue({
    sourceCreditBucket: { id: "bucket-new" },
  });
  const updatePeriodMock = vi.fn().mockResolvedValue({});
  const findMemberMock = vi.fn().mockResolvedValue({ userId: OWNER_ID });

  return {
    createTransactionMock,
    findUniqueBucketMock,
    findMemberMock,
    updatePeriodMock,
    tx: {
      creditBucket: {
        findUnique: findUniqueBucketMock,
      },
      enterpriseContractPeriod: {
        update: updatePeriodMock,
      },
      member: {
        findFirst: findMemberMock,
      },
      transaction: {
        create: createTransactionMock,
      },
    } as unknown as PrismaType.TransactionClient,
  };
}

describe("grantEnterpriseScheduledPeriod", () => {
  it("creates a bucket with explicit activatesAt and flips the period to active", async () => {
    const client = createGrantClient();
    const activatesAt = new Date("2026-06-01T00:00:00.000Z");

    const result = await grantEnterpriseScheduledPeriod(
      createScheduledPeriod(),
      activatesAt,
      client.tx,
    );

    assert.equal(result.bucketCreated, true);
    assert.equal(result.periodActivated, true);
    assert.equal(client.createTransactionMock.mock.calls.length, 1);
    assert.equal(
      client.createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create.activatesAt.toISOString(),
      activatesAt.toISOString(),
    );
    assert.equal(
      client.updatePeriodMock.mock.calls[0]?.[0].data.status,
      EnterpriseContractPeriodStatus.active,
    );
  });

  it("is idempotent when the period bucket already exists", async () => {
    const client = createGrantClient();
    client.tx.creditBucket.findUnique = vi.fn().mockResolvedValue({
      activatesAt: new Date("2026-06-01T00:00:00.000Z"),
      id: "existing-bucket",
    });

    const result = await grantEnterpriseScheduledPeriod(
      createScheduledPeriod(),
      new Date("2026-06-01T00:00:00.000Z"),
      client.tx,
    );

    assert.equal(result.bucketCreated, false);
    assert.equal(result.periodActivated, true);
    assert.equal(client.createTransactionMock.mock.calls.length, 0);
  });
});

describe("expireActiveEnterprisePeriodsWithElapsedBuckets", () => {
  it("expires active periods whose bucket expiresAt is in the past", async () => {
    const now = new Date("2026-06-15T00:00:00.000Z");
    const updatePeriodMock = vi.fn().mockResolvedValue({});
    const findManyPeriodsMock = vi.fn().mockResolvedValue([{ id: PERIOD_ID }]);
    const findUniqueBucketMock = vi.fn().mockResolvedValue({
      activatesAt: new Date("2026-05-01T00:00:00.000Z"),
      expiresAt: new Date("2026-06-01T00:00:00.000Z"),
      id: "bucket-1",
    });

    const tx = {
      creditBucket: {
        findUnique: findUniqueBucketMock,
      },
      enterpriseContractPeriod: {
        findMany: findManyPeriodsMock,
        update: updatePeriodMock,
      },
    } as unknown as PrismaType.TransactionClient;

    const count = await expireActiveEnterprisePeriodsWithElapsedBuckets(
      tx,
      now,
    );

    assert.equal(count, 1);
    assert.equal(
      updatePeriodMock.mock.calls[0]?.[0].data.status,
      EnterpriseContractPeriodStatus.expired,
    );
  });

  it("skips active periods whose bucket has not expired yet", async () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const updatePeriodMock = vi.fn().mockResolvedValue({});

    const tx = {
      creditBucket: {
        findUnique: vi.fn().mockResolvedValue({
          activatesAt: new Date("2026-05-01T00:00:00.000Z"),
          expiresAt: new Date("2026-07-01T00:00:00.000Z"),
          id: "bucket-1",
        }),
      },
      enterpriseContractPeriod: {
        findMany: vi.fn().mockResolvedValue([{ id: PERIOD_ID }]),
        update: updatePeriodMock,
      },
    } as unknown as PrismaType.TransactionClient;

    const count = await expireActiveEnterprisePeriodsWithElapsedBuckets(
      tx,
      now,
    );

    assert.equal(count, 0);
    assert.equal(updatePeriodMock.mock.calls.length, 0);
  });
});

describe("resolveCatchUpActivatesAt", () => {
  it("uses now when catch-up runs within the period window", () => {
    const periodStart = new Date("2026-06-01T00:00:00.000Z");
    const periodEnd = new Date("2026-06-30T23:59:59.999Z");
    const now = new Date("2026-06-02T00:00:00.000Z");

    assert.equal(
      resolveCatchUpActivatesAt({ periodEnd, periodStart }, now).toISOString(),
      now.toISOString(),
    );
  });

  it("uses periodStart when catch-up runs after periodEnd", () => {
    const periodStart = new Date("2026-07-01T00:00:00.000Z");
    const periodEnd = new Date("2026-07-31T23:59:59.999Z");
    const now = new Date("2027-01-01T00:00:00.000Z");

    assert.equal(
      resolveCatchUpActivatesAt({ periodEnd, periodStart }, now).toISOString(),
      periodStart.toISOString(),
    );
  });
});

describe("catchUpScheduledEnterprisePeriods", () => {
  it("grants due periods with activatesAt = now", async () => {
    const now = new Date("2026-06-02T00:00:00.000Z");
    const client = createGrantClient();
    client.tx.enterpriseContractPeriod.findMany = vi.fn().mockResolvedValue([
      createScheduledPeriod({
        periodEnd: new Date("2026-06-30T23:59:59.999Z"),
        periodStart: new Date("2026-06-01T00:00:00.000Z"),
      }),
    ]);

    const count = await catchUpScheduledEnterprisePeriods(client.tx, now);

    assert.equal(count, 1);
    assert.equal(
      client.createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket
        .create.activatesAt,
      now,
    );
  });

  it("uses periodStart when catch-up runs after periodEnd", async () => {
    const periodStart = new Date("2026-07-01T00:00:00.000Z");
    const periodEnd = new Date("2026-07-31T23:59:59.999Z");
    const now = new Date("2027-01-01T00:00:00.000Z");
    const client = createGrantClient();
    client.tx.enterpriseContractPeriod.findMany = vi
      .fn()
      .mockResolvedValue([createScheduledPeriod({ periodEnd, periodStart })]);

    const count = await catchUpScheduledEnterprisePeriods(client.tx, now);

    assert.equal(count, 1);
    assert.equal(
      client.createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create.activatesAt.toISOString(),
      periodStart.toISOString(),
    );
    assert.equal(
      client.createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create.expiresAt.toISOString(),
      periodEnd.toISOString(),
    );
    assert.equal(
      client.updatePeriodMock.mock.calls[0]?.[0].data.status,
      EnterpriseContractPeriodStatus.expired,
    );
  });
});

describe("preCreateUpcomingEnterprisePeriods", () => {
  it("pre-creates buckets within the 24h window using periodStart as activatesAt", async () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const periodStart = new Date("2026-06-01T12:00:00.000Z");
    const client = createGrantClient();
    client.tx.enterpriseContractPeriod.findMany = vi
      .fn()
      .mockResolvedValue([createScheduledPeriod({ periodStart })]);

    const count = await preCreateUpcomingEnterprisePeriods(client.tx, now);

    assert.equal(count, 1);
    assert.equal(
      client.createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create.activatesAt.toISOString(),
      periodStart.toISOString(),
    );
    assert.equal(
      client.createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket
        .create.referenceType,
      CreditBucketReferenceType.ENTERPRISE_PERIOD,
    );
  });
});

describe("runEnterpriseContractSchedulerPass", () => {
  it("runs expiry, catch-up, pre-create, then completion in order", async () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const callOrder: string[] = [];

    const tx = {
      enterpriseContract: {
        findMany: vi.fn().mockImplementation(() => {
          callOrder.push("complete");
          return Promise.resolve([]);
        }),
        update: vi.fn(),
      },
      enterpriseContractPeriod: {
        findMany: vi
          .fn()
          .mockImplementationOnce(() => {
            callOrder.push("expire");
            return Promise.resolve([]);
          })
          .mockImplementationOnce(() => {
            callOrder.push("catch-up");
            return Promise.resolve([]);
          })
          .mockImplementationOnce(() => {
            callOrder.push("pre-create");
            return Promise.resolve([]);
          }),
        update: vi.fn(),
      },
    } as unknown as PrismaType.TransactionClient;

    const result = await runEnterpriseContractSchedulerPass(tx, now);

    assert.deepEqual(callOrder, [
      "expire",
      "catch-up",
      "pre-create",
      "complete",
    ]);
    assert.equal(result.completedContracts, 0);
    assert.equal(result.expiredPeriods, 0);
    assert.equal(result.catchUpGranted, 0);
    assert.equal(result.preCreated, 0);
  });

  it("grants due periods before completing contracts past the commercial term", async () => {
    const now = new Date("2027-01-01T00:00:00.000Z");
    const client = createGrantClient();
    const scheduledLastPeriod = createScheduledPeriod({
      periodEnd: new Date("2026-07-31T23:59:59.999Z"),
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
    });
    const updateContractMock = vi.fn().mockResolvedValue({});

    const tx = {
      ...client.tx,
      enterpriseContract: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "contract-1",
            periodCount: 3,
            activatedAt: new Date("2026-05-01T00:00:00.000Z"),
          },
        ]),
        update: updateContractMock,
      },
      enterpriseContractPeriod: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([scheduledLastPeriod])
          .mockResolvedValueOnce([]),
        update: client.updatePeriodMock,
      },
    } as unknown as PrismaType.TransactionClient;

    const result = await runEnterpriseContractSchedulerPass(tx, now);

    assert.equal(result.catchUpGranted, 1);
    assert.equal(result.completedContracts, 1);
    assert.equal(client.createTransactionMock.mock.calls.length, 1);
    assert.equal(
      client.createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create.activatesAt.toISOString(),
      scheduledLastPeriod.periodStart.toISOString(),
    );
    assert.equal(
      client.updatePeriodMock.mock.calls[0]?.[0].data.status,
      EnterpriseContractPeriodStatus.expired,
    );
    assert.equal(updateContractMock.mock.calls.length, 1);
  });

  it("completes contracts past the commercial term", async () => {
    const now = new Date("2027-01-01T00:00:00.000Z");
    const updateContractMock = vi.fn().mockResolvedValue({});

    const tx = {
      enterpriseContract: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "contract-1",
            periodCount: 3,
            activatedAt: new Date("2026-05-01T00:00:00.000Z"),
          },
        ]),
        update: updateContractMock,
      },
      enterpriseContractPeriod: {
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
    } as unknown as PrismaType.TransactionClient;

    const result = await runEnterpriseContractSchedulerPass(tx, now);

    assert.equal(result.completedContracts, 1);
    assert.equal(
      updateContractMock.mock.calls[0]?.[0].data.status,
      EnterpriseContractStatus.completed,
    );
  });
});
