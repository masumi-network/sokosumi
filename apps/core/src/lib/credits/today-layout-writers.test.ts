import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import * as dbHelpers from "@sokosumi/database/helpers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { envState, wakeMock } = vi.hoisted(() => ({
  envState: {
    DATABASE_SCHEMA_SHARED: "public",
    DATABASE_SCHEMA_MAINNET: "public",
    DATABASE_SCHEMA_PREPROD: "public",
    NETWORK_PREPROD_ENABLED: false,
  },
  wakeMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => envState,
}));

vi.mock("@/services/task-topup.service", () => ({
  markOutOfCreditsTasksAsToppedUp: wakeMock,
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();
  return {
    ...actual,
    findCreditBucketByReference: vi.fn(actual.findCreditBucketByReference),
    insertCreditGrant: vi.fn(actual.insertCreditGrant),
    mintMonotonicUuidV7: vi.fn(actual.mintMonotonicUuidV7),
  };
});

import { createCompensatingRefund } from "@/helpers/compensating-refund";
import type { MainnetScope, NetworkScope } from "@/lib/db/network-scope";
import {
  cmoPaidFor,
  findUnpaidCusoHiredBy,
  isCmoProjectUnpaid,
} from "@/services/cmo-billing.service";
import { expireEnterpriseGrants, grant } from "./grant";
import { writeOff } from "./write-off";

const scope = { network: "mainnet" } as MainnetScope;

function setLayout(split: boolean): void {
  envState.DATABASE_SCHEMA_SHARED = split ? "shared" : "public";
  envState.DATABASE_SCHEMA_MAINNET = split ? "mainnet" : "public";
  envState.DATABASE_SCHEMA_PREPROD = split ? "preprod" : "public";
  envState.NETWORK_PREPROD_ENABLED = split;
}

function makeTodayTx() {
  const creditBucketFindUnique = vi.fn().mockResolvedValue(null);
  const creditBucketFindFirst = vi.fn().mockResolvedValue(null);
  const creditBucketFindMany = vi.fn().mockResolvedValue([]);
  const creditBucketUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const transactionCreate = vi.fn().mockResolvedValue({
    id: "tx-prisma-id",
    sourceCreditBucket: { id: "bucket-prisma-id" },
  });
  const polarSubscriptionFindFirst = vi.fn().mockResolvedValue(null);
  const projectFindFirst = vi.fn().mockResolvedValue(null);
  const sokoBotFindFirst = vi.fn().mockResolvedValue(null);
  const sokoBotUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
  const executeRaw = vi.fn<(...args: unknown[]) => unknown>(() => {
    throw new Error("Split raw SQL writer called on today's layout");
  });
  const queryRaw = vi.fn<(...args: unknown[]) => unknown>(() => {
    throw new Error("Split raw SQL reader called on today's layout");
  });
  const tx = {
    creditBucket: {
      findUnique: creditBucketFindUnique,
      findFirst: creditBucketFindFirst,
      findMany: creditBucketFindMany,
      updateMany: creditBucketUpdateMany,
    },
    transaction: {
      create: transactionCreate,
    },
    polarSubscription: {
      findFirst: polarSubscriptionFindFirst,
    },
    project: {
      findFirst: projectFindFirst,
    },
    sokoBot: {
      findFirst: sokoBotFindFirst,
      updateMany: sokoBotUpdateMany,
    },
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
  } as unknown as Prisma.TransactionClient;

  return {
    tx,
    creditBucketFindUnique,
    creditBucketFindFirst,
    creditBucketFindMany,
    creditBucketUpdateMany,
    transactionCreate,
    polarSubscriptionFindFirst,
    projectFindFirst,
    sokoBotFindFirst,
    executeRaw,
    queryRaw,
  };
}

describe("structural guard: today's layout never invokes split raw SQL writers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLayout(false);
  });

  afterEach(() => {
    setLayout(false);
  });

  it("keeps every grant kind and enterprise expiry on origin/main's Prisma path on today's layout", async () => {
    const mock = makeTodayTx();
    const now = new Date("2026-11-28T00:00:00.000Z");

    await grant({
      scope,
      tx: mock.tx,
      kind: "signup_bonus",
      userId: "user-1",
      credits: 100,
      expiresAt: null,
      wakeTasks: false,
    });
    await grant({
      scope,
      tx: mock.tx,
      kind: "free",
      target: { targetType: "user", userId: "user-1" },
      credits: 10,
      expiresAt: null,
      grantId: "grant-1",
      note: null,
      wakeTasks: false,
    });
    await grant({
      scope,
      tx: mock.tx,
      kind: "cmo_tester",
      target: { targetType: "organization", organizationId: "org-1" },
      projectId: "proj-1",
      credits: 10,
      expiresAt: null,
      grantId: "grant-2",
      note: "tester",
      wakeTasks: false,
    });
    await grant({
      scope,
      tx: mock.tx,
      kind: "local_free_period",
      owner: { userId: "user-1" },
      credits: 250,
      periodEnd: now,
      activatesAt: null,
      wakeTasks: false,
    });
    await grant({
      scope,
      tx: mock.tx,
      kind: "enterprise_period",
      organizationId: "org-1",
      periodId: "period-1",
      cents: 10n,
      activatesAt: now,
      expiresAt: now,
      wakeTasks: false,
    });
    await grant({
      scope,
      tx: mock.tx,
      kind: "enterprise_top_up",
      organizationId: "org-1",
      contractId: "contract-1",
      cents: 20n,
      activatesAt: now,
      expiresAt: null,
      wakeTasks: false,
    });
    await grant({
      scope,
      tx: mock.tx,
      kind: "polar",
      organizationId: "org-1",
      projectId: "proj-1",
      cents: 30n,
      referenceId: "order-1:0",
      referenceType: CreditBucketReferenceType.POLAR_SUBSCRIPTION_MONTH,
      note: "Growth",
      expiresAt: now,
      wakeTasks: false,
    });
    await grant({
      scope,
      tx: mock.tx,
      kind: "stripe_invoice",
      owner: { organizationId: "org-1" },
      invoiceId: "in_1",
      entry: "topup",
      cents: 40n,
      referenceType: CreditBucketReferenceType.STRIPE_TOPUP,
      expiresAt: null,
      wakeTasks: false,
    });
    await expireEnterpriseGrants({
      scope,
      tx: mock.tx,
      periodIds: ["period-1"],
      topUpContractId: "contract-1",
      now,
    });

    expect(mock.transactionCreate).toHaveBeenCalledTimes(8);
    expect(mock.creditBucketUpdateMany).toHaveBeenCalledOnce();
    expect(mock.executeRaw).not.toHaveBeenCalled();
    expect(mock.queryRaw).not.toHaveBeenCalled();
    expect(dbHelpers.insertCreditGrant).not.toHaveBeenCalled();
    expect(dbHelpers.findCreditBucketByReference).not.toHaveBeenCalled();
    expect(dbHelpers.mintMonotonicUuidV7).not.toHaveBeenCalled();
  });

  it("keeps writeOff and createCompensatingRefund on origin/main's Prisma writes on today's layout", async () => {
    const mock = makeTodayTx();
    mock.queryRaw.mockResolvedValueOnce([
      {
        id: "bucket-1",
        organizationId: "org-1",
        userId: null,
        remaining: 15n,
      },
    ]);

    await writeOff({ scope, tx: mock.tx, of: { bucketIds: ["bucket-1"] } });
    expect(mock.transactionCreate).toHaveBeenCalledOnce();
    expect(mock.executeRaw).not.toHaveBeenCalled();

    mock.transactionCreate.mockClear();
    await createCompensatingRefund(mock.tx, {
      amount: 15n,
      actorUserId: "user-1",
      organizationId: null,
      referenceId: "ref-1",
      consumptions: [{ amount: 15n, bucket: { projectId: null } }],
    });
    expect(mock.transactionCreate).toHaveBeenCalledOnce();
    const refundCall = mock.transactionCreate.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect("id" in refundCall.data).toBe(false);
    expect(mock.executeRaw).not.toHaveBeenCalled();
  });

  it("keeps CMO billing queries on origin/main's Prisma delegates on today's layout", async () => {
    const mock = makeTodayTx();
    const now = new Date("2026-11-28T00:00:00.000Z");

    await isCmoProjectUnpaid("proj-1", mock.tx);
    await findUnpaidCusoHiredBy("user-1", mock.tx);
    await cmoPaidFor("proj-1", now, scope as NetworkScope, mock.tx);

    expect(mock.projectFindFirst).toHaveBeenCalledOnce();
    expect(mock.sokoBotFindFirst).toHaveBeenCalledOnce();
    expect(mock.polarSubscriptionFindFirst).toHaveBeenCalledOnce();
    expect(mock.creditBucketFindMany).toHaveBeenCalledOnce();
    expect(mock.queryRaw).not.toHaveBeenCalled();
    expect(mock.executeRaw).not.toHaveBeenCalled();
  });

  it("routes grant writers, enterprise expiry, and writeOff to split raw SQL only on the split layout", async () => {
    setLayout(true);
    const executeRaw = vi.fn().mockResolvedValue(1);
    const queryRaw = vi.fn().mockResolvedValue([]);
    const transactionCreate = vi.fn(() => {
      throw new Error(
        "Legacy Prisma transaction.create called on split layout",
      );
    });
    const creditBucketUpdateMany = vi.fn(() => {
      throw new Error(
        "Legacy Prisma creditBucket.updateMany called on split layout",
      );
    });
    const tx = {
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
      transaction: { create: transactionCreate },
      creditBucket: { updateMany: creditBucketUpdateMany },
    } as unknown as Prisma.TransactionClient;
    const now = new Date("2026-11-28T00:00:00.000Z");

    await grant({
      scope,
      tx,
      kind: "polar",
      organizationId: "org-1",
      projectId: "proj-1",
      cents: 30n,
      referenceId: "order-1:0",
      referenceType: CreditBucketReferenceType.POLAR_SUBSCRIPTION_MONTH,
      note: "Growth",
      expiresAt: now,
      wakeTasks: false,
    });
    await grant({
      scope,
      tx,
      kind: "stripe_invoice",
      owner: { organizationId: "org-1" },
      invoiceId: "in_1",
      entry: "topup",
      cents: 40n,
      referenceType: CreditBucketReferenceType.STRIPE_TOPUP,
      expiresAt: null,
      wakeTasks: false,
    });
    await expireEnterpriseGrants({
      scope,
      tx,
      periodIds: ["period-1"],
      topUpContractId: null,
      now,
    });

    queryRaw.mockResolvedValueOnce([
      { id: "bucket-1", organizationId: "org-1", userId: null, remaining: 5n },
    ]);
    await writeOff({ scope, tx, of: { bucketIds: ["bucket-1"] } });

    expect(transactionCreate).not.toHaveBeenCalled();
    expect(creditBucketUpdateMany).not.toHaveBeenCalled();
    expect(dbHelpers.insertCreditGrant).toHaveBeenCalledTimes(2);
    expect(dbHelpers.findCreditBucketByReference).toHaveBeenCalledOnce();
    expect(executeRaw).toHaveBeenCalled();
  });

  it("keeps enterprise contract scheduler reads on Prisma on today's layout and routes to split SQL only when requested", async () => {
    const mock = makeTodayTx();
    const periodFindMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: "period-1" }])
      .mockResolvedValue([]);
    const contractFindMany = vi.fn().mockResolvedValue([]);
    const todayTx = {
      ...mock.tx,
      enterpriseContractPeriod: { findMany: periodFindMany },
      enterpriseContract: { findMany: contractFindMany },
    } as unknown as Prisma.TransactionClient;

    await dbHelpers.runEnterpriseContractSchedulerPass(
      todayTx,
      vi.fn(),
      new Date("2026-11-28T00:00:00.000Z"),
    );
    expect(mock.creditBucketFindUnique).toHaveBeenCalledOnce();
    expect(dbHelpers.findCreditBucketByReference).not.toHaveBeenCalled();
    expect(mock.queryRaw).not.toHaveBeenCalled();

    const splitQueryRaw = vi.fn().mockResolvedValue([]);
    const splitPeriodFindMany = vi
      .fn()
      .mockResolvedValueOnce([{ id: "period-1" }])
      .mockResolvedValue([]);
    const splitFindUnique = vi.fn(() => {
      throw new Error("Legacy Prisma creditBucket.findUnique on split");
    });
    const splitTx = {
      $queryRaw: splitQueryRaw,
      creditBucket: {
        findUnique: splitFindUnique,
      },
      enterpriseContractPeriod: { findMany: splitPeriodFindMany },
      enterpriseContract: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as Prisma.TransactionClient;

    await dbHelpers.runEnterpriseContractSchedulerPass(
      splitTx,
      vi.fn(),
      new Date("2026-11-28T00:00:00.000Z"),
      { splitSql: true },
    );
    expect(splitFindUnique).not.toHaveBeenCalled();
    expect(splitQueryRaw).toHaveBeenCalledOnce();
  });
});
