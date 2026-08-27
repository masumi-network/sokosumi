import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import {
  CreditBucketReferenceType,
  EnterpriseContractPeriodStatus,
  EnterpriseContractStatus,
  type Prisma as PrismaType,
} from "../generated/prisma/client.js";
import { deriveEnterpriseContractEndDate } from "./enterprise-contract.js";
import { findPaidSubscriptionsBlockingEnterpriseActivation } from "./enterprise-contract-exclusivity.js";
import {
  createEnterprisePeriodCreditBucket,
  createEnterpriseTopUpCreditBucket,
  expireCreditBucketsNow,
} from "./enterprise-contract-grants.js";
import {
  activateEnterpriseContract,
  cancelEnterpriseContract,
  completeEnterpriseContractsAfterLastPeriod,
  EnterpriseContractActivationError,
  EnterpriseContractLifecycleError,
} from "./enterprise-contract-lifecycle.js";

const CENTS_PER_MONTH = 600_000_000_000_000n;
const ORG_ID = "org-1";
const CONTRACT_ID = "01900000-0000-7000-8000-000000000001";
const PERIOD_ID = "01900000-0000-7000-8000-000000000101";
const OWNER_ID = "owner-1";

function createGrantClient(params?: { existingBucketReferenceIds?: string[] }) {
  const findUniqueBucketMock = vi.fn().mockImplementation(
    ({
      where,
    }: {
      where: {
        referenceId_referenceType: {
          referenceId: string;
        };
      };
    }) =>
      Promise.resolve(
        params?.existingBucketReferenceIds?.includes(
          where.referenceId_referenceType.referenceId,
        )
          ? { id: "existing-bucket" }
          : null,
      ),
  );
  const createTransactionMock = vi.fn().mockResolvedValue({
    sourceCreditBucket: { id: "bucket-new" },
  });

  return {
    createTransactionMock,
    findUniqueBucketMock,
    tx: {
      creditBucket: {
        findUnique: findUniqueBucketMock,
      },
      transaction: {
        create: createTransactionMock,
      },
    } as unknown as PrismaType.TransactionClient,
  };
}

function createDraftContract(overrides?: {
  oneTimeCents?: bigint | null;
  periodCount?: number;
  status?: EnterpriseContractStatus;
}) {
  return {
    activatedAt: null,
    canceledAt: null,
    centsPerMonth: CENTS_PER_MONTH,
    externalReference: null,
    id: CONTRACT_ID,
    notes: null,
    oneTimeCents: overrides?.oneTimeCents ?? null,
    oneTimeExpiresAt: null,
    organizationId: ORG_ID,
    paymentReference: null,
    periodCount: overrides?.periodCount ?? 3,
    periods: [] as Array<{
      centsToGrant: bigint;
      id: string;
      periodEnd: Date;
      periodStart: Date;
      purchasedSeats: number;
      status: EnterpriseContractPeriodStatus;
    }>,
    seats: 10,
    status: overrides?.status ?? EnterpriseContractStatus.draft,
  };
}

function createLifecycleClient(params?: {
  blockers?: Array<{
    plan: string;
    referenceId: string;
    scope: "organization";
    stripeSubscriptionId: string;
    subscriptionId: string;
  }>;
  contract?: Partial<ReturnType<typeof createDraftContract>> & {
    periods?: Array<{
      centsToGrant: bigint;
      id: string;
      periodEnd: Date;
      periodStart: Date;
      purchasedSeats: number;
      status: EnterpriseContractPeriodStatus;
    }>;
    status?: EnterpriseContractStatus;
  };
  existingBucketReferenceIds?: string[];
  ownerId?: string;
}) {
  const contract = {
    ...createDraftContract(),
    ...params?.contract,
  };

  const createdPeriods: Array<{
    centsToGrant: bigint;
    contractId: string;
    id: string;
    periodEnd: Date;
    periodStart: Date;
    purchasedSeats: number;
    status: EnterpriseContractPeriodStatus;
  }> = [];

  let periodCounter = 0;
  const createPeriodMock = vi.fn().mockImplementation(
    ({
      data,
    }: {
      data: {
        centsToGrant: bigint;
        contractId: string;
        periodEnd: Date;
        periodStart: Date;
        purchasedSeats: number;
        status: EnterpriseContractPeriodStatus;
      };
    }) => {
      periodCounter += 1;
      const period = {
        centsToGrant: data.centsToGrant,
        contractId: data.contractId,
        id: `${PERIOD_ID.slice(0, -1)}${periodCounter}`,
        periodEnd: data.periodEnd,
        periodStart: data.periodStart,
        purchasedSeats: data.purchasedSeats,
        status: data.status,
      };
      createdPeriods.push(period);
      return Promise.resolve(period);
    },
  );

  const updatePeriodMock = vi.fn().mockResolvedValue({});
  const deleteManyPeriodsMock = vi.fn().mockResolvedValue({ count: 0 });
  const updateContractMock = vi.fn().mockResolvedValue({});
  const findContractMock = vi.fn().mockResolvedValue(contract);
  const findActiveContractMock = vi.fn().mockResolvedValue(null);
  const findManyContractsMock = vi.fn().mockResolvedValue([]);
  const findMemberMock = vi
    .fn()
    .mockResolvedValue({ userId: params?.ownerId ?? OWNER_ID });
  const findManyMembersMock = vi
    .fn()
    .mockResolvedValue([{ userId: OWNER_ID }, { userId: "member-1" }]);
  const resolveActiveSubscriptionMock = vi.fn().mockResolvedValue(null);
  const findFirstBucketMock = vi.fn().mockResolvedValue(null);
  const updateManyBucketsMock = vi.fn().mockResolvedValue({ count: 0 });

  const grantClient = createGrantClient({
    existingBucketReferenceIds: params?.existingBucketReferenceIds,
  });

  return {
    contract,
    createPeriodMock,
    createdPeriods,
    deleteManyPeriodsMock,
    findActiveContractMock,
    findManyContractsMock,
    findContractMock,
    findMemberMock,
    findManyMembersMock,
    grantClient,
    resolveActiveSubscriptionMock,
    updateContractMock,
    updateManyBucketsMock,
    updatePeriodMock,
    tx: {
      ...grantClient.tx,
      creditBucket: {
        findFirst: findFirstBucketMock,
        findUnique: grantClient.findUniqueBucketMock,
        updateMany: updateManyBucketsMock,
      },
      enterpriseContract: {
        findFirst: findActiveContractMock,
        findMany: findManyContractsMock,
        findUnique: findContractMock,
        update: updateContractMock,
      },
      enterpriseContractPeriod: {
        create: createPeriodMock,
        deleteMany: deleteManyPeriodsMock,
        update: updatePeriodMock,
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      member: {
        findFirst: findMemberMock,
        findMany: findManyMembersMock,
      },
      subscription: {
        findFirst: resolveActiveSubscriptionMock,
      },
      transaction: grantClient.tx.transaction,
    } as unknown as PrismaType.TransactionClient,
  };
}

describe("createEnterprisePeriodCreditBucket", () => {
  it("creates an org-level bucket with null userId", async () => {
    const { createTransactionMock, tx } = createGrantClient();
    const activatesAt = new Date("2026-05-01T00:00:00.000Z");
    const expiresAt = new Date("2026-05-31T23:59:59.999Z");

    const result = await createEnterprisePeriodCreditBucket(
      {
        activatesAt,
        amount: CENTS_PER_MONTH,
        expiresAt,
        organizationId: ORG_ID,
        periodId: PERIOD_ID,
        transactionUserId: OWNER_ID,
      },
      tx,
    );

    assert.equal(result.created, true);
    assert.equal(result.bucketId, "bucket-new");
    assert.equal(createTransactionMock.mock.calls.length, 1);
    assert.equal(
      createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create
        .userId,
      null,
    );
    assert.equal(
      createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create
        .referenceType,
      CreditBucketReferenceType.ENTERPRISE_PERIOD,
    );
    assert.equal(
      createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create
        .referenceId,
      PERIOD_ID,
    );
  });

  it("skips creation when the bucket already exists", async () => {
    const { createTransactionMock, tx } = createGrantClient({
      existingBucketReferenceIds: [PERIOD_ID],
    });

    const result = await createEnterprisePeriodCreditBucket(
      {
        activatesAt: new Date("2026-05-01T00:00:00.000Z"),
        amount: CENTS_PER_MONTH,
        expiresAt: new Date("2026-05-31T23:59:59.999Z"),
        organizationId: ORG_ID,
        periodId: PERIOD_ID,
        transactionUserId: OWNER_ID,
      },
      tx,
    );

    assert.equal(result.created, false);
    assert.equal(result.bucketId, "existing-bucket");
    assert.equal(createTransactionMock.mock.calls.length, 0);
  });
});

describe("createEnterpriseTopUpCreditBucket", () => {
  it("is idempotent per contract id", async () => {
    const { createTransactionMock, tx } = createGrantClient({
      existingBucketReferenceIds: [CONTRACT_ID],
    });

    const result = await createEnterpriseTopUpCreditBucket(
      {
        activatesAt: new Date("2026-05-01T00:00:00.000Z"),
        amount: 100_000_000_000_000n,
        contractId: CONTRACT_ID,
        expiresAt: null,
        organizationId: ORG_ID,
        transactionUserId: OWNER_ID,
      },
      tx,
    );

    assert.equal(result.created, false);
    assert.equal(createTransactionMock.mock.calls.length, 0);
  });
});

describe("expireCreditBucketsNow", () => {
  it("expires only matching unexpired buckets", async () => {
    const updateManyMock = vi.fn().mockResolvedValue({ count: 2 });
    const now = new Date("2026-06-01T00:00:00.000Z");
    const tx = {
      creditBucket: {
        updateMany: updateManyMock,
      },
    } as unknown as PrismaType.TransactionClient;

    const count = await expireCreditBucketsNow(
      {
        now,
        referenceIds: [PERIOD_ID, CONTRACT_ID],
        referenceTypes: [
          CreditBucketReferenceType.ENTERPRISE_PERIOD,
          CreditBucketReferenceType.ENTERPRISE_TOP_UP,
        ],
      },
      tx,
    );

    assert.equal(count, 2);
    assert.equal(updateManyMock.mock.calls[0]?.[0].data.expiresAt, now);
  });
});

describe("findPaidSubscriptionsBlockingEnterpriseActivation", () => {
  it("lists an organization paid subscription with consumable buckets", async () => {
    const findFirstBucketMock = vi
      .fn()
      .mockResolvedValueOnce({ id: "org-bucket" });
    const resolveActiveSubscriptionMock = vi.fn().mockResolvedValueOnce({
      id: "sub-org",
      plan: "starter",
      stripeSubscriptionId: "sub_stripe_org",
    });

    const tx = {
      creditBucket: {
        findFirst: findFirstBucketMock,
      },
      member: {
        findMany: vi.fn().mockResolvedValue([{ userId: "member-1" }]),
      },
      subscription: {
        findFirst: resolveActiveSubscriptionMock,
      },
    } as unknown as PrismaType.TransactionClient;

    const blocker = await findPaidSubscriptionsBlockingEnterpriseActivation(
      ORG_ID,
      tx,
      new Date("2026-05-01T00:00:00.000Z"),
    );

    assert.ok(blocker);
    assert.equal(blocker.scope, "organization");
  });

  it("ignores member personal subscriptions", async () => {
    const findFirstBucketMock = vi.fn().mockResolvedValue(null);
    const resolveActiveSubscriptionMock = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "sub-member",
        plan: "starter",
        stripeSubscriptionId: "sub_stripe_member",
      });

    const tx = {
      creditBucket: {
        findFirst: findFirstBucketMock,
      },
      member: {
        findMany: vi.fn().mockResolvedValue([{ userId: "member-1" }]),
      },
      subscription: {
        findFirst: resolveActiveSubscriptionMock,
      },
    } as unknown as PrismaType.TransactionClient;

    const blocker = await findPaidSubscriptionsBlockingEnterpriseActivation(
      ORG_ID,
      tx,
      new Date("2026-05-01T00:00:00.000Z"),
    );

    assert.equal(blocker, null);
  });

  it("returns no blocker when a paid subscription has no consumable buckets", async () => {
    const tx = {
      creditBucket: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      member: {
        findMany: vi.fn().mockResolvedValue([{ userId: "member-1" }]),
      },
      subscription: {
        findFirst: vi.fn().mockResolvedValue({
          id: "sub-org",
          plan: "starter",
          stripeSubscriptionId: "sub_stripe_org",
        }),
      },
    } as unknown as PrismaType.TransactionClient;

    const blocker = await findPaidSubscriptionsBlockingEnterpriseActivation(
      ORG_ID,
      tx,
      new Date("2026-05-01T00:00:00.000Z"),
    );

    assert.equal(blocker, null);
  });
});

describe("activateEnterpriseContract", () => {
  it("persists activatedAt and materializes periods from activation time", async () => {
    const activatedAt = new Date("2026-05-01T12:00:00.000Z");
    const client = createLifecycleClient();

    const result = await activateEnterpriseContract(
      CONTRACT_ID,
      {
        activatedAt,
        paymentReference: "wire-123",
      },
      client.tx,
    );

    assert.equal(result.periodsCreated, 3);
    assert.equal(result.periodBucketCreated, true);
    assert.equal(client.createPeriodMock.mock.calls.length, 3);
    assert.equal(client.updatePeriodMock.mock.calls.length, 1);
    assert.equal(
      client.updateContractMock.mock.calls[0]?.[0].data.activatedAt.toISOString(),
      activatedAt.toISOString(),
    );
    assert.equal(
      client.updateContractMock.mock.calls[0]?.[0].data.status,
      EnterpriseContractStatus.active,
    );
    assert.equal(
      client.updateContractMock.mock.calls[0]?.[0].data.paymentReference,
      "wire-123",
    );
    assert.equal(
      client.grantClient.createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create.activatesAt.toISOString(),
      activatedAt.toISOString(),
    );
  });

  it("deletes draft preview periods before materializing the schedule", async () => {
    const client = createLifecycleClient({
      contract: {
        periods: [
          {
            centsToGrant: CENTS_PER_MONTH,
            id: "preview-period-1",
            periodEnd: new Date("2026-02-01T00:00:00.000Z"),
            periodStart: new Date("2026-01-01T00:00:00.000Z"),
            purchasedSeats: 10,
            status: EnterpriseContractPeriodStatus.scheduled,
          },
        ],
      },
    });

    await activateEnterpriseContract(
      CONTRACT_ID,
      { activatedAt: new Date("2026-05-01T00:00:00.000Z") },
      client.tx,
    );

    assert.equal(client.deleteManyPeriodsMock.mock.calls.length, 1);
    assert.equal(
      client.deleteManyPeriodsMock.mock.calls[0]?.[0].where.contractId,
      CONTRACT_ID,
    );
    assert.equal(client.createPeriodMock.mock.calls.length, 3);
  });

  it("allows activation when a paid subscription has no consumable buckets", async () => {
    const client = createLifecycleClient();
    client.tx.creditBucket.findFirst = vi.fn().mockResolvedValue(null);
    client.tx.subscription.findFirst = vi.fn().mockResolvedValue({
      id: "sub-org",
      plan: "starter",
      stripeSubscriptionId: "sub_stripe_org",
    });

    const result = await activateEnterpriseContract(
      CONTRACT_ID,
      { activatedAt: new Date("2026-05-01T00:00:00.000Z") },
      client.tx,
    );

    assert.equal(result.periodsCreated, 3);
    assert.equal(result.periodBucketCreated, true);
    assert.equal(
      client.updateContractMock.mock.calls[0]?.[0].data.status,
      EnterpriseContractStatus.active,
    );
  });

  it("rejects activation when paid subscriptions block", async () => {
    const client = createLifecycleClient();
    const findFirstBucketMock = vi
      .fn()
      .mockResolvedValue({ id: "paid-bucket" });
    const resolveActiveSubscriptionMock = vi.fn().mockResolvedValue({
      id: "sub-org",
      plan: "starter",
      stripeSubscriptionId: "sub_stripe_org",
    });
    client.tx.creditBucket.findFirst = findFirstBucketMock;
    client.tx.subscription.findFirst = resolveActiveSubscriptionMock;

    await assert.rejects(
      () =>
        activateEnterpriseContract(
          CONTRACT_ID,
          { activatedAt: new Date("2026-05-01T00:00:00.000Z") },
          client.tx,
        ),
      (error: unknown) => {
        assert.ok(error instanceof EnterpriseContractActivationError);
        assert.equal(error.blocker.scope, "organization");
        return true;
      },
    );
  });

  it("creates an optional top-up bucket on activation", async () => {
    const client = createLifecycleClient({
      contract: {
        oneTimeCents: 100_000_000_000_000n,
      },
    });

    const result = await activateEnterpriseContract(
      CONTRACT_ID,
      { activatedAt: new Date("2026-05-01T00:00:00.000Z") },
      client.tx,
    );

    assert.equal(result.topUpBucketCreated, true);
    assert.equal(client.grantClient.createTransactionMock.mock.calls.length, 2);
  });

  it("returns periodBucketCreated false when period-1 bucket already exists on activation", async () => {
    const client = createLifecycleClient({
      existingBucketReferenceIds: [PERIOD_ID.slice(0, -1) + "1"],
    });

    const result = await activateEnterpriseContract(
      CONTRACT_ID,
      { activatedAt: new Date("2026-05-01T00:00:00.000Z") },
      client.tx,
    );

    assert.equal(result.periodBucketCreated, false);
    assert.equal(client.grantClient.createTransactionMock.mock.calls.length, 0);
  });

  it("completes a past-term active contract before activating a new draft", async () => {
    const activatedAt = new Date("2027-06-01T00:00:00.000Z");
    const expiredActivatedAt = new Date("2026-01-01T00:00:00.000Z");
    const client = createLifecycleClient();
    client.findManyContractsMock.mockResolvedValue([
      {
        activatedAt: expiredActivatedAt,
        id: "expired-active-contract",
        periodCount: 1,
      },
    ]);

    const result = await activateEnterpriseContract(
      CONTRACT_ID,
      { activatedAt },
      client.tx,
    );

    assert.equal(result.periodsCreated, 3);
    assert.equal(client.findManyContractsMock.mock.calls.length, 1);
    const completedExpiredContract = client.updateContractMock.mock.calls.some(
      (call: [{ data: { status: string }; where: { id: string } }]) =>
        call[0]?.where.id === "expired-active-contract" &&
        call[0]?.data.status === EnterpriseContractStatus.completed,
    );
    assert.equal(completedExpiredContract, true);
  });

  it("rejects activation when the organization already has an active contract", async () => {
    const client = createLifecycleClient();
    client.tx.enterpriseContract.findFirst = vi
      .fn()
      .mockResolvedValue({ id: "other-active-contract" });

    await assert.rejects(
      () =>
        activateEnterpriseContract(
          CONTRACT_ID,
          { activatedAt: new Date("2026-05-01T00:00:00.000Z") },
          client.tx,
        ),
      (error: unknown) => {
        assert.ok(error instanceof EnterpriseContractLifecycleError);
        assert.match(
          error.message,
          /Organization already has an active enterprise contract/,
        );
        return true;
      },
    );
  });

  it("rejects activation when the organization has no members", async () => {
    const client = createLifecycleClient();
    client.tx.member.findFirst = vi.fn().mockResolvedValue(null);

    await assert.rejects(
      () =>
        activateEnterpriseContract(
          CONTRACT_ID,
          { activatedAt: new Date("2026-05-01T00:00:00.000Z") },
          client.tx,
        ),
      (error: unknown) => {
        assert.ok(error instanceof EnterpriseContractLifecycleError);
        assert.match(error.message, /Organization org-1 has no members/);
        return true;
      },
    );
  });

  it("rejects non-draft contracts", async () => {
    const client = createLifecycleClient({
      contract: {
        status: EnterpriseContractStatus.active,
      },
    });

    await assert.rejects(
      () =>
        activateEnterpriseContract(
          CONTRACT_ID,
          { activatedAt: new Date("2026-05-01T00:00:00.000Z") },
          client.tx,
        ),
      EnterpriseContractLifecycleError,
    );
  });
});

describe("cancelEnterpriseContract", () => {
  it("expires buckets and voids scheduled periods", async () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const scheduledPeriod = {
      centsToGrant: CENTS_PER_MONTH,
      id: "period-scheduled",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-06-01T00:00:00.000Z"),
      purchasedSeats: 10,
      status: EnterpriseContractPeriodStatus.scheduled,
    };
    const activeFuturePeriod = {
      centsToGrant: CENTS_PER_MONTH,
      id: "period-future-active",
      periodEnd: new Date("2026-08-01T00:00:00.000Z"),
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      purchasedSeats: 10,
      status: EnterpriseContractPeriodStatus.active,
    };

    const updateManyPeriodsMock = vi.fn().mockResolvedValue({ count: 1 });
    const updatePeriodMock = vi.fn().mockResolvedValue({});
    const updateManyBucketsMock = vi.fn().mockResolvedValue({ count: 2 });
    const updateContractMock = vi.fn().mockResolvedValue({});
    const findUniqueBucketMock = vi.fn().mockResolvedValue({
      activatesAt: new Date("2026-07-01T00:00:00.000Z"),
      id: "bucket-future",
    });

    const tx = {
      creditBucket: {
        findUnique: findUniqueBucketMock,
        updateMany: updateManyBucketsMock,
      },
      enterpriseContract: {
        findUnique: vi.fn().mockResolvedValue({
          id: CONTRACT_ID,
          oneTimeCents: 100_000_000_000_000n,
          organizationId: ORG_ID,
          periods: [scheduledPeriod, activeFuturePeriod],
          status: EnterpriseContractStatus.active,
        }),
        update: updateContractMock,
      },
      enterpriseContractPeriod: {
        update: updatePeriodMock,
        updateMany: updateManyPeriodsMock,
      },
    } as unknown as PrismaType.TransactionClient;

    await cancelEnterpriseContract(CONTRACT_ID, tx, now);

    assert.equal(updateManyBucketsMock.mock.calls.length, 1);
    assert.equal(updateManyPeriodsMock.mock.calls.length, 1);
    assert.equal(
      updateManyPeriodsMock.mock.calls[0]?.[0].where.status,
      EnterpriseContractPeriodStatus.scheduled,
    );
    assert.equal(updatePeriodMock.mock.calls.length, 1);
    assert.equal(
      updatePeriodMock.mock.calls[0]?.[0].data.status,
      EnterpriseContractPeriodStatus.void,
    );
    assert.equal(
      updateContractMock.mock.calls[0]?.[0].data.status,
      EnterpriseContractStatus.canceled,
    );
  });

  it("expires the current period bucket and marks the period expired, not void", async () => {
    const now = new Date("2026-06-01T00:00:00.000Z");
    const currentActivePeriod = {
      centsToGrant: CENTS_PER_MONTH,
      id: "period-current",
      periodEnd: new Date("2026-07-01T00:00:00.000Z"),
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
      purchasedSeats: 10,
      status: EnterpriseContractPeriodStatus.active,
    };

    const updatePeriodMock = vi.fn().mockResolvedValue({});
    const updateManyBucketsMock = vi.fn().mockResolvedValue({ count: 1 });
    const findUniqueBucketMock = vi.fn().mockResolvedValue({
      activatesAt: new Date("2026-05-01T00:00:00.000Z"),
      id: "bucket-current",
    });

    const tx = {
      creditBucket: {
        findUnique: findUniqueBucketMock,
        updateMany: updateManyBucketsMock,
      },
      enterpriseContract: {
        findUnique: vi.fn().mockResolvedValue({
          id: CONTRACT_ID,
          oneTimeCents: null,
          organizationId: ORG_ID,
          periods: [currentActivePeriod],
          status: EnterpriseContractStatus.active,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      enterpriseContractPeriod: {
        update: updatePeriodMock,
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaType.TransactionClient;

    await cancelEnterpriseContract(CONTRACT_ID, tx, now);

    assert.equal(updateManyBucketsMock.mock.calls.length, 1);
    assert.deepEqual(
      updateManyBucketsMock.mock.calls[0]?.[0].where.referenceId.in,
      ["period-current"],
    );
    assert.equal(updatePeriodMock.mock.calls.length, 1);
    assert.equal(
      updatePeriodMock.mock.calls[0]?.[0].data.status,
      EnterpriseContractPeriodStatus.expired,
    );
    assert.notEqual(
      updatePeriodMock.mock.calls[0]?.[0].data.status,
      EnterpriseContractPeriodStatus.void,
    );
  });

  it("rejects canceling non-active contracts", async () => {
    const tx = {
      enterpriseContract: {
        findUnique: vi.fn().mockResolvedValue({
          id: CONTRACT_ID,
          periods: [],
          status: EnterpriseContractStatus.draft,
        }),
      },
    } as unknown as PrismaType.TransactionClient;

    await assert.rejects(
      () => cancelEnterpriseContract(CONTRACT_ID, tx),
      EnterpriseContractLifecycleError,
    );
  });
});

describe("completeEnterpriseContractsAfterLastPeriod", () => {
  const activatedAt = new Date("2026-05-01T00:00:00.000Z");
  const periodCount = 3;
  const endsAt = deriveEnterpriseContractEndDate(activatedAt, periodCount);

  function createCompletionClient(
    contracts: Array<{
      activatedAt: Date | null;
      id: string;
      periodCount: number;
    }>,
  ) {
    const updateMock = vi.fn().mockResolvedValue({});

    return {
      updateMock,
      tx: {
        enterpriseContract: {
          findMany: vi.fn().mockResolvedValue(contracts),
          update: updateMock,
        },
      } as unknown as PrismaType.TransactionClient,
    };
  }

  it("does not complete contracts at the exact contract end (strict after boundary)", async () => {
    const client = createCompletionClient([
      {
        activatedAt,
        id: CONTRACT_ID,
        periodCount,
      },
    ]);

    const count = await completeEnterpriseContractsAfterLastPeriod(
      client.tx,
      endsAt,
    );

    assert.equal(count, 0);
    assert.equal(client.updateMock.mock.calls.length, 0);
  });

  it("completes contracts after the last period ends", async () => {
    const client = createCompletionClient([
      {
        activatedAt,
        id: CONTRACT_ID,
        periodCount,
      },
    ]);

    const count = await completeEnterpriseContractsAfterLastPeriod(
      client.tx,
      new Date(endsAt.getTime() + 1),
    );

    assert.equal(count, 1);
    assert.equal(client.updateMock.mock.calls.length, 1);
    assert.equal(
      client.updateMock.mock.calls[0]?.[0].data.status,
      EnterpriseContractStatus.completed,
    );
    assert.equal(client.updateMock.mock.calls[0]?.[0].where.id, CONTRACT_ID);
  });

  it("skips contracts still within the commercial term", async () => {
    const client = createCompletionClient([
      {
        activatedAt,
        id: CONTRACT_ID,
        periodCount,
      },
      {
        activatedAt: new Date("2026-06-01T00:00:00.000Z"),
        id: "contract-still-active",
        periodCount: 12,
      },
    ]);

    const count = await completeEnterpriseContractsAfterLastPeriod(
      client.tx,
      new Date(endsAt.getTime() + 1),
    );

    assert.equal(count, 1);
    assert.equal(client.updateMock.mock.calls.length, 1);
    assert.equal(client.updateMock.mock.calls[0]?.[0].where.id, CONTRACT_ID);
  });
});
