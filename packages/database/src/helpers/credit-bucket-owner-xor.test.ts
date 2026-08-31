import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, vi } from "vitest";

import { CreditBucketReferenceType } from "../generated/prisma/client.js";
import { ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX } from "./credit.js";
import {
  CreditBucketOwnerXorError,
  classifyCreditBucketOwner,
  creditBucketOwnerClassAction,
  inventoryCreditBucketOwnerXor,
  listDualOwnedCreditBuckets,
  reconcileCreditBucketOwnerXor,
} from "./credit-bucket-owner-xor.js";

const MIGRATION_SQL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../prisma/migrations/20260831154500_credit_bucket_owner_xor/migration.sql",
);

describe("classifyCreditBucketOwner", () => {
  it("keeps personal and org XOR rows", () => {
    assert.equal(
      classifyCreditBucketOwner({
        organizationId: null,
        referenceId: "user:u1:topup",
        referenceType: CreditBucketReferenceType.STRIPE_TOPUP,
        remaining: 10n,
        userId: "user-1",
      }),
      "personal",
    );
    assert.equal(creditBucketOwnerClassAction("personal"), "keep");
    assert.equal(
      classifyCreditBucketOwner({
        organizationId: "org-1",
        referenceId: "org:org-1:in_1:subscription",
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        remaining: 10n,
        userId: null,
      }),
      "org",
    );
    assert.equal(creditBucketOwnerClassAction("org"), "keep");
  });

  it("classifies leftover member: period rows including legacy-split", () => {
    assert.equal(
      classifyCreditBucketOwner({
        organizationId: "org-1",
        referenceId: "member:user-1:in_1Abc:subscription",
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        remaining: 0n,
        userId: "user-1",
      }),
      "leftover_member_period_rem0",
    );
    assert.equal(
      creditBucketOwnerClassAction("leftover_member_period_rem0"),
      "delete",
    );
    assert.equal(
      classifyCreditBucketOwner({
        organizationId: "org-1",
        referenceId: "member:user-1:legacy-split:clxyz",
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        remaining: 500n,
        userId: "user-1",
      }),
      "leftover_member_period_rem_gt0",
    );
    assert.equal(
      creditBucketOwnerClassAction("leftover_member_period_rem_gt0"),
      "drain_then_delete",
    );
    assert.equal(
      classifyCreditBucketOwner({
        organizationId: "org-1",
        referenceId: "member:user-1:local-free:org-1:2026-05-01T00:00:00.000Z",
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        remaining: -1n,
        userId: "user-1",
      }),
      "leftover_member_period_rem0",
    );
  });

  it("classifies dual-owned org period keys as null userId, never leftover member drain", () => {
    assert.equal(
      classifyCreditBucketOwner({
        organizationId: "org-1",
        referenceId: "org:org-1:in_1:subscription",
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        remaining: 250n,
        userId: "owner-1",
      }),
      "dual_owned_org_period",
    );
    assert.equal(
      classifyCreditBucketOwner({
        organizationId: "org-1",
        referenceId:
          "org:org-1:migrated-member-period:2026-08-01T00:00:00.000Z:none:none",
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
        remaining: 1n,
        userId: "owner-1",
      }),
      "dual_owned_org_period",
    );
    assert.equal(
      creditBucketOwnerClassAction("dual_owned_org_period"),
      "null_user_id",
    );
  });

  it("classifies dual-owned non-period rows as null userId", () => {
    assert.equal(
      classifyCreditBucketOwner({
        organizationId: "org-1",
        referenceId: "org:org-1:free:grant-1",
        referenceType: CreditBucketReferenceType.FREE,
        remaining: 1n,
        userId: "user-1",
      }),
      "dual_owned_non_period",
    );
    assert.equal(
      classifyCreditBucketOwner({
        organizationId: "org-1",
        referenceId: "org:org-1:in_1:topup",
        referenceType: CreditBucketReferenceType.STRIPE_TOPUP,
        remaining: 80n,
        userId: "user-1",
      }),
      "dual_owned_non_period",
    );
    assert.equal(
      classifyCreditBucketOwner({
        organizationId: "org-1",
        referenceId: "org:org-1:refund:job-1",
        referenceType: CreditBucketReferenceType.REFUND,
        remaining: 40n,
        userId: "user-1",
      }),
      "dual_owned_non_period",
    );
    assert.equal(
      classifyCreditBucketOwner({
        organizationId: "org-1",
        referenceId: null,
        referenceType: null,
        remaining: 0n,
        userId: "user-1",
      }),
      "dual_owned_non_period",
    );
    assert.equal(
      creditBucketOwnerClassAction("dual_owned_non_period"),
      "null_user_id",
    );
  });

  it("fails closed on both-null remaining and deletes remaining-0", () => {
    assert.equal(
      classifyCreditBucketOwner({
        organizationId: null,
        referenceId: null,
        referenceType: null,
        remaining: 12n,
        userId: null,
      }),
      "both_null_rem_gt0",
    );
    assert.equal(
      creditBucketOwnerClassAction("both_null_rem_gt0"),
      "fail_closed",
    );
    assert.equal(
      classifyCreditBucketOwner({
        organizationId: null,
        referenceId: null,
        referenceType: CreditBucketReferenceType.FREE,
        remaining: 0n,
        userId: null,
      }),
      "both_null_rem0",
    );
    assert.equal(creditBucketOwnerClassAction("both_null_rem0"), "delete");
  });
});

describe("credit_bucket_owner_xor migration SQL", () => {
  const sql = readFileSync(MIGRATION_SQL_PATH, "utf8");

  it("drains leftover member: period remaining before any userId null, and never mints", () => {
    const memberLike = `LIKE '${ORGANIZATION_MEMBER_SUBSCRIPTION_REFERENCE_PREFIX}%'`;
    const drainIdx = sql.indexOf(memberLike);
    const firstNullIdx = sql.indexOf('SET "userId" = NULL');
    assert.notEqual(drainIdx, -1);
    assert.notEqual(firstNullIdx, -1);
    assert.ok(drainIdx < firstNullIdx);
    assert.equal(sql.includes("INSERT INTO credit_bucket"), false);
    assert.ok(sql.includes("AS MATERIALIZED"));
    assert.ok(sql.includes("credit_bucket_owner_xor_check"));
    assert.ok(sql.includes("ON DELETE CASCADE"));
    assert.ok(
      sql.includes("refuse to invent an owner") ||
        sql.includes("both userId and organizationId null"),
    );
  });
});

function createPrismaMock(options: {
  afterRows?: unknown[];
  createTransaction?: ReturnType<typeof vi.fn>;
  deleteMany?: ReturnType<typeof vi.fn>;
  rows: unknown[];
  updateMany?: ReturnType<typeof vi.fn>;
}) {
  const createTransaction =
    options.createTransaction ?? vi.fn().mockResolvedValue({ id: "tx-1" });
  const deleteMany =
    options.deleteMany ?? vi.fn().mockResolvedValue({ count: 0 });
  const updateMany =
    options.updateMany ?? vi.fn().mockResolvedValue({ count: 0 });
  const queryRaw = vi.fn();
  queryRaw.mockResolvedValueOnce(options.rows);
  queryRaw.mockResolvedValueOnce(options.rows);
  queryRaw.mockResolvedValueOnce(options.afterRows ?? []);

  const prisma = {
    $queryRaw: queryRaw,
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(prisma),
    ),
    creditBucket: {
      deleteMany,
      updateMany,
    },
    transaction: {
      create: createTransaction,
    },
  };
  return prisma;
}

describe("inventoryCreditBucketOwnerXor", () => {
  it("counts leftover member period remaining separately from org period dual-owned", async () => {
    const prisma = createPrismaMock({
      rows: [
        {
          id: "leftover-1",
          organizationId: "org-1",
          referenceId: "member:user-1:legacy-split:clxyz",
          referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
          remaining: 80n,
          userId: "user-1",
        },
        {
          id: "org-period-1",
          organizationId: "org-1",
          referenceId: "org:org-1:in_1:subscription",
          referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
          remaining: 250n,
          userId: "owner-1",
        },
      ],
    });

    const inventory = await inventoryCreditBucketOwnerXor(prisma as never);

    assert.equal(inventory.counts.leftover_member_period_rem_gt0, 1);
    assert.equal(inventory.counts.dual_owned_org_period, 1);
    assert.equal(
      inventory.remainingCentsByClass.leftover_member_period_rem_gt0,
      80n,
    );
  });
});

describe("reconcileCreditBucketOwnerXor", () => {
  it("dry-run drains leftover remaining on paper and writes nothing", async () => {
    const createTransaction = vi.fn();
    const prisma = createPrismaMock({
      createTransaction,
      rows: [
        {
          id: "leftover-1",
          organizationId: "org-1",
          referenceId: "member:user-1:in_1:subscription",
          referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
          remaining: 90n,
          userId: "user-1",
        },
      ],
    });

    const result = await reconcileCreditBucketOwnerXor(prisma as never, {
      dryRun: true,
    });

    assert.equal(result.drainedLeftoverMemberPeriod, 1);
    assert.equal(result.drainedLeftoverMemberPeriodCents, 90n);
    assert.equal(result.deletedLeftoverMemberPeriod, 1);
    assert.equal(createTransaction.mock.calls.length, 0);
    assert.equal(prisma.creditBucket.deleteMany.mock.calls.length, 0);
    assert.equal(prisma.$transaction.mock.calls.length, 0);
  });

  it("write-off leftover member period remaining with the leftover userId and does not mint", async () => {
    const createTransaction = vi.fn().mockResolvedValue({ id: "drain-tx" });
    const prisma = createPrismaMock({
      afterRows: [],
      createTransaction,
      rows: [
        {
          id: "leftover-1",
          organizationId: "org-1",
          referenceId: "member:user-1:legacy-split:clxyz",
          referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
          remaining: 90n,
          userId: "user-1",
        },
      ],
    });

    const result = await reconcileCreditBucketOwnerXor(prisma as never);

    assert.equal(result.drainedLeftoverMemberPeriod, 1);
    assert.equal(result.deletedLeftoverMemberPeriod, 1);
    assert.equal(createTransaction.mock.calls.length, 1);
    const drain = createTransaction.mock.calls[0]?.[0].data;
    assert.equal(drain.amount, -90n);
    assert.equal(drain.userId, "user-1");
    assert.equal(drain.organizationId, "org-1");
    assert.deepEqual(drain.creditConsumptions.create, {
      amount: 90n,
      bucketId: "leftover-1",
    });
    assert.equal(drain.sourceCreditBucket, undefined);
    assert.deepEqual(prisma.creditBucket.deleteMany.mock.calls[0]?.[0], {
      where: { id: { in: ["leftover-1"] } },
    });
    assert.equal(prisma.creditBucket.updateMany.mock.calls.length, 0);
  });

  it("deletes remaining-0 leftover member period rows without a drain transaction", async () => {
    const createTransaction = vi.fn();
    const prisma = createPrismaMock({
      afterRows: [],
      createTransaction,
      rows: [
        {
          id: "tombstone-1",
          organizationId: "org-1",
          referenceId: "member:user-1:in_1:subscription",
          referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
          remaining: 0n,
          userId: "user-1",
        },
      ],
    });

    const result = await reconcileCreditBucketOwnerXor(prisma as never);

    assert.equal(result.drainedLeftoverMemberPeriod, 0);
    assert.equal(result.deletedLeftoverMemberPeriod, 1);
    assert.equal(createTransaction.mock.calls.length, 0);
  });

  it("nulls userId on dual-owned org period and non-period rows", async () => {
    const prisma = createPrismaMock({
      afterRows: [],
      rows: [
        {
          id: "org-period-1",
          organizationId: "org-1",
          referenceId: "org:org-1:in_1:subscription",
          referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
          remaining: 250n,
          userId: "owner-1",
        },
        {
          id: "topup-1",
          organizationId: "org-1",
          referenceId: "org:org-1:topup:1",
          referenceType: CreditBucketReferenceType.STRIPE_TOPUP,
          remaining: 10n,
          userId: "user-1",
        },
      ],
    });

    const result = await reconcileCreditBucketOwnerXor(prisma as never);

    assert.equal(result.nulledDualOwnedOrgPeriod, 1);
    assert.equal(result.nulledDualOwnedNonPeriod, 1);
    assert.deepEqual(prisma.creditBucket.updateMany.mock.calls[0]?.[0], {
      data: { userId: null },
      where: { id: { in: ["topup-1"] } },
    });
    assert.deepEqual(prisma.creditBucket.updateMany.mock.calls[1]?.[0], {
      data: { userId: null },
      where: { id: { in: ["org-period-1"] } },
    });
    assert.equal(prisma.transaction.create.mock.calls.length, 0);
  });

  it("deletes both-null remaining-0 rows", async () => {
    const prisma = createPrismaMock({
      afterRows: [],
      rows: [
        {
          id: "orphan-0",
          organizationId: null,
          referenceId: null,
          referenceType: null,
          remaining: 0n,
          userId: null,
        },
      ],
    });

    const result = await reconcileCreditBucketOwnerXor(prisma as never);

    assert.equal(result.deletedBothNullRem0, 1);
    assert.deepEqual(prisma.creditBucket.deleteMany.mock.calls[0]?.[0], {
      where: { id: { in: ["orphan-0"] } },
    });
  });

  it("fails closed on both-null remaining without writes", async () => {
    const prisma = createPrismaMock({
      rows: [
        {
          id: "orphan-live",
          organizationId: null,
          referenceId: null,
          referenceType: null,
          remaining: 15n,
          userId: null,
        },
      ],
    });

    await assert.rejects(
      () => reconcileCreditBucketOwnerXor(prisma as never),
      (error: unknown) => {
        assert.ok(error instanceof CreditBucketOwnerXorError);
        assert.match(error.message, /refuse to invent an owner/);
        return true;
      },
    );
    assert.equal(prisma.transaction.create.mock.calls.length, 0);
    assert.equal(prisma.creditBucket.deleteMany.mock.calls.length, 0);
    assert.equal(prisma.$transaction.mock.calls.length, 0);
  });

  it("fails closed on dry-run when both-null remaining exists", async () => {
    const prisma = createPrismaMock({
      rows: [
        {
          id: "orphan-live",
          organizationId: null,
          referenceId: null,
          referenceType: null,
          remaining: 15n,
          userId: null,
        },
      ],
    });

    await assert.rejects(
      () => reconcileCreditBucketOwnerXor(prisma as never, { dryRun: true }),
      (error: unknown) => {
        assert.ok(error instanceof CreditBucketOwnerXorError);
        assert.match(error.message, /refuse to invent an owner/);
        return true;
      },
    );
    assert.equal(prisma.$transaction.mock.calls.length, 0);
  });
});
