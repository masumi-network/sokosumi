import assert from "node:assert/strict";

import { describe, it, vi } from "vitest";

import { CreditBucketReferenceType } from "../generated/prisma/client.js";
import { buildOrganizationInvoiceCreditReferenceId } from "./credit.js";
import {
  assertSentinelsCoverLeftoverMemberPeriods,
  backfillOrgPeriodIdempotencySentinels,
  deleteCoveredMemberPeriodTombstones,
  ensureOrgPeriodIdempotencySentinel,
  orgPeriodFingerprintExists,
  parseMemberPeriodReferenceId,
  SENTINEL_FACE_CENTS,
  SENTINEL_REFERENCE_NOTE,
} from "./org-period-idempotency-sentinels.js";
import { buildLocalFreeOrganizationSubscriptionReferenceId } from "./subscription.js";

describe("parseMemberPeriodReferenceId", () => {
  it("parses leftover invoice subscription refs into org invoice fingerprints", () => {
    const parsed = parseMemberPeriodReferenceId(
      "member:user-1:in_1Abc:subscription",
      "org-1",
    );

    assert.equal(parsed.isOk(), true);
    if (parsed.isOk()) {
      assert.equal(parsed.value.kind, "invoice_subscription");
      assert.equal(parsed.value.fingerprint, "in_1Abc");
      assert.equal(
        parsed.value.orgReferenceId,
        buildOrganizationInvoiceCreditReferenceId(
          "org-1",
          "in_1Abc",
          "subscription",
        ),
      );
    }
  });

  it("parses leftover local-free refs into org local-free fingerprints", () => {
    const periodEnd = new Date("2026-05-01T00:00:00.000Z");
    const parsed = parseMemberPeriodReferenceId(
      `member:user-1:local-free:org-1:${periodEnd.toISOString()}`,
      "org-1",
    );

    assert.equal(parsed.isOk(), true);
    if (parsed.isOk()) {
      assert.equal(parsed.value.kind, "local_free_subscription");
      assert.equal(parsed.value.fingerprint, periodEnd.toISOString());
      assert.equal(
        parsed.value.orgReferenceId,
        buildLocalFreeOrganizationSubscriptionReferenceId("org-1", periodEnd),
      );
    }
  });

  it("rejects unparseable and mismatched refs", () => {
    assert.equal(
      parseMemberPeriodReferenceId(
        "org:org-1:in_1:subscription",
        "org-1",
      ).isErr(),
      true,
    );
    assert.equal(
      parseMemberPeriodReferenceId(
        "member:user-1:local-free:other-org:2026-05-01T00:00:00.000Z",
        "org-1",
      ).isErr(),
      true,
    );
    assert.equal(
      parseMemberPeriodReferenceId(
        "member:user-1:migrated-member-period:x",
        "org-1",
      ).isErr(),
      true,
    );
  });
});

describe("ensureOrgPeriodIdempotencySentinel", () => {
  it("creates a 1¢ org bucket and fully consumes it in the same transaction", async () => {
    const findUniqueMock = vi.fn().mockResolvedValue(null);
    const createTransactionMock = vi
      .fn()
      .mockResolvedValueOnce({
        sourceCreditBucket: { id: "sentinel-bucket" },
      })
      .mockResolvedValueOnce({ id: "drain-tx" });

    const outcome = await ensureOrgPeriodIdempotencySentinel(
      {
        creditBucket: { findUnique: findUniqueMock },
        transaction: { create: createTransactionMock },
      } as never,
      {
        actorUserId: "owner-1",
        activatesAt: null,
        expiresAt: new Date("2026-09-01T00:00:00.000Z"),
        kind: "invoice_subscription",
        organizationId: "org-1",
        referenceId: buildOrganizationInvoiceCreditReferenceId(
          "org-1",
          "in_1",
          "subscription",
        ),
        sourceBucketId: "leftover-1",
      },
    );

    assert.equal(outcome, "created");
    assert.equal(createTransactionMock.mock.calls.length, 2);

    const grant = createTransactionMock.mock.calls[0]?.[0].data;
    assert.equal(grant.amount, SENTINEL_FACE_CENTS);
    assert.equal(grant.userId, "owner-1");
    assert.equal(grant.organizationId, "org-1");
    assert.equal(grant.sourceCreditBucket.create.amount, SENTINEL_FACE_CENTS);
    assert.equal(grant.sourceCreditBucket.create.userId, null);
    assert.equal(
      grant.sourceCreditBucket.create.referenceNote,
      SENTINEL_REFERENCE_NOTE,
    );
    assert.equal(
      grant.sourceCreditBucket.create.referenceType,
      CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
    );

    const drain = createTransactionMock.mock.calls[1]?.[0].data;
    assert.equal(drain.amount, SENTINEL_FACE_CENTS * -1n);
    assert.deepEqual(drain.creditConsumptions.create, {
      amount: SENTINEL_FACE_CENTS,
      bucketId: "sentinel-bucket",
    });
  });

  it("returns already_present when the org fingerprint already exists", async () => {
    const createTransactionMock = vi.fn();
    const outcome = await ensureOrgPeriodIdempotencySentinel(
      {
        creditBucket: {
          findUnique: vi.fn().mockResolvedValue({ id: "live-grant" }),
        },
        transaction: { create: createTransactionMock },
      } as never,
      {
        actorUserId: "owner-1",
        activatesAt: null,
        expiresAt: null,
        kind: "invoice_subscription",
        organizationId: "org-1",
        referenceId: buildOrganizationInvoiceCreditReferenceId(
          "org-1",
          "in_1",
          "subscription",
        ),
        sourceBucketId: "leftover-1",
      },
    );

    assert.equal(outcome, "already_present");
    assert.equal(createTransactionMock.mock.calls.length, 0);
  });

  it("treats unique races as already_present", async () => {
    const outcome = await ensureOrgPeriodIdempotencySentinel(
      {
        creditBucket: { findUnique: vi.fn().mockResolvedValue(null) },
        transaction: {
          create: vi.fn().mockRejectedValue(
            Object.assign(new Error("Unique constraint failed"), {
              code: "P2002",
            }),
          ),
        },
      } as never,
      {
        actorUserId: "owner-1",
        activatesAt: null,
        expiresAt: null,
        kind: "local_free_subscription",
        organizationId: "org-1",
        referenceId: buildLocalFreeOrganizationSubscriptionReferenceId(
          "org-1",
          new Date("2026-05-01T00:00:00.000Z"),
        ),
        sourceBucketId: "leftover-1",
      },
    );

    assert.equal(outcome, "already_present");
  });

  it("uses epoch expiresAt when leftover expiry is null", async () => {
    const createTransactionMock = vi.fn().mockResolvedValue({
      sourceCreditBucket: { id: "sentinel-bucket" },
    });

    await ensureOrgPeriodIdempotencySentinel(
      {
        creditBucket: { findUnique: vi.fn().mockResolvedValue(null) },
        transaction: { create: createTransactionMock },
      } as never,
      {
        actorUserId: "owner-1",
        activatesAt: null,
        expiresAt: null,
        kind: "invoice_subscription",
        organizationId: "org-1",
        referenceId: buildOrganizationInvoiceCreditReferenceId(
          "org-1",
          "in_1",
          "subscription",
        ),
        sourceBucketId: "leftover-1",
      },
    );

    assert.equal(
      createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create.expiresAt.toISOString(),
      new Date(0).toISOString(),
    );
  });
});

describe("backfillOrgPeriodIdempotencySentinels", () => {
  it("dedupes leftovers to distinct fingerprints and creates sentinels", async () => {
    const invoiceRef = buildOrganizationInvoiceCreditReferenceId(
      "org-1",
      "in_shared",
      "subscription",
    );
    const queryRawMock = vi.fn().mockResolvedValue([
      {
        id: "b-1",
        referenceId: "member:user-1:in_shared:subscription",
        organizationId: "org-1",
        userId: "user-1",
        expiresAt: new Date("2026-09-01T00:00:00.000Z"),
        activatesAt: null,
        remaining: 0n,
      },
      {
        id: "b-2",
        referenceId: "member:user-2:in_shared:subscription",
        organizationId: "org-1",
        userId: "user-2",
        expiresAt: new Date("2026-09-01T00:00:00.000Z"),
        activatesAt: null,
        remaining: 0n,
      },
    ]);
    const findUniqueMock = vi.fn().mockResolvedValue(null);
    const createTransactionMock = vi
      .fn()
      .mockResolvedValueOnce({
        sourceCreditBucket: { id: "sentinel-1" },
      })
      .mockResolvedValueOnce({ id: "drain-1" });

    const prisma = {
      $queryRaw: queryRawMock,
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          creditBucket: { findUnique: findUniqueMock },
          transaction: { create: createTransactionMock },
        }),
      ),
      creditBucket: { findUnique: findUniqueMock },
      member: { findFirst: vi.fn() },
    };

    const result = await backfillOrgPeriodIdempotencySentinels(
      prisma as never,
      {},
    );

    assert.equal(result.scannedLeftovers, 2);
    assert.equal(result.distinctFingerprints, 1);
    assert.equal(result.created, 1);
    assert.equal(result.alreadyPresent, 0);
    assert.equal(result.unparseable, 0);
    assert.equal(
      createTransactionMock.mock.calls[0]?.[0].data.sourceCreditBucket.create
        .referenceId,
      invoiceRef,
    );
  });

  it("counts already_present when live org grant occupies the fingerprint", async () => {
    const referenceId = buildOrganizationInvoiceCreditReferenceId(
      "org-1",
      "in_live",
      "subscription",
    );
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: "b-1",
          referenceId: "member:user-1:in_live:subscription",
          organizationId: "org-1",
          userId: "user-1",
          expiresAt: null,
          activatesAt: null,
          remaining: 0n,
        },
      ]),
      $transaction: vi.fn(async (callback: (tx: unknown) => unknown) =>
        callback({
          creditBucket: {
            findUnique: vi.fn().mockResolvedValue({ id: "live" }),
          },
          transaction: { create: vi.fn() },
        }),
      ),
      creditBucket: {
        findUnique: vi.fn().mockResolvedValue({ id: "live" }),
      },
      member: { findFirst: vi.fn() },
    };

    const result = await backfillOrgPeriodIdempotencySentinels(
      prisma as never,
      {},
    );

    assert.equal(result.created, 0);
    assert.equal(result.alreadyPresent, 1);
    assert.equal(result.distinctFingerprints, 1);
    void referenceId;
  });

  it("dryRun counts would-create without writing", async () => {
    const createTransactionMock = vi.fn();
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: "b-1",
          referenceId: "member:user-1:in_dry:subscription",
          organizationId: "org-1",
          userId: "user-1",
          expiresAt: null,
          activatesAt: null,
          remaining: 0n,
        },
      ]),
      $transaction: vi.fn(),
      creditBucket: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      member: { findFirst: vi.fn() },
      transaction: { create: createTransactionMock },
    };

    const result = await backfillOrgPeriodIdempotencySentinels(
      prisma as never,
      { dryRun: true },
    );

    assert.equal(result.created, 1);
    assert.equal(prisma.$transaction.mock.calls.length, 0);
    assert.equal(createTransactionMock.mock.calls.length, 0);
  });

  it("emits verbose debug lines when debug is provided", async () => {
    const debugMessages: string[] = [];
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: "b-1",
          referenceId: "member:user-1:in_verbose:subscription",
          organizationId: "org-1",
          userId: "user-1",
          expiresAt: null,
          activatesAt: null,
          remaining: 0n,
        },
      ]),
      $transaction: vi.fn(),
      creditBucket: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      member: { findFirst: vi.fn() },
      transaction: { create: vi.fn() },
    };

    await backfillOrgPeriodIdempotencySentinels(prisma as never, {
      debug: (message) => {
        debugMessages.push(message);
      },
      dryRun: true,
    });

    assert.ok(debugMessages.some((message) => message.startsWith("collect:")));
    assert.ok(
      debugMessages.some((message) => message.includes("dry-run wouldCreate")),
    );
    assert.ok(
      debugMessages.some((message) => message.startsWith("backfill done:")),
    );
  });
});

describe("assertSentinelsCoverLeftoverMemberPeriods", () => {
  it("fails when a leftover fingerprint lacks an org key", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: "b-1",
          referenceId: "member:user-1:in_missing:subscription",
          organizationId: "org-1",
          userId: "user-1",
          expiresAt: null,
          activatesAt: null,
          remaining: 0n,
        },
      ]),
      creditBucket: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    };

    const result = await assertSentinelsCoverLeftoverMemberPeriods(
      prisma as never,
    );

    assert.equal(result.isErr(), true);
    if (result.isErr()) {
      assert.equal(result.error.unparseable, 0);
      assert.deepEqual(result.error.uncoveredReferenceIds, [
        buildOrganizationInvoiceCreditReferenceId(
          "org-1",
          "in_missing",
          "subscription",
        ),
      ]);
    }
  });

  it("passes when every leftover fingerprint exists", async () => {
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: "b-1",
          referenceId: "member:user-1:in_ok:subscription",
          organizationId: "org-1",
          userId: "user-1",
          expiresAt: null,
          activatesAt: null,
          remaining: 0n,
        },
      ]),
      creditBucket: {
        findUnique: vi.fn().mockResolvedValue({ id: "sentinel" }),
      },
    };

    const result = await assertSentinelsCoverLeftoverMemberPeriods(
      prisma as never,
    );
    assert.equal(result.isOk(), true);
  });
});

describe("deleteCoveredMemberPeriodTombstones", () => {
  it("deletes only remaining-0 covered member period tombstones", async () => {
    const coveredInvoice = buildOrganizationInvoiceCreditReferenceId(
      "org-1",
      "in_covered",
      "subscription",
    );
    const deleteManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const findUniqueMock = vi.fn().mockImplementation(
      ({
        where,
      }: {
        where: {
          referenceId_referenceType: { referenceId: string };
        };
      }) =>
        Promise.resolve(
          where.referenceId_referenceType.referenceId === coveredInvoice
            ? { id: "sentinel" }
            : null,
        ),
    );

    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: "covered-0",
          referenceId: "member:user-1:in_covered:subscription",
          organizationId: "org-1",
          userId: "user-1",
          expiresAt: null,
          activatesAt: null,
          remaining: 0n,
        },
        {
          id: "remaining-positive",
          referenceId: "member:user-1:in_covered:subscription",
          organizationId: "org-1",
          userId: "user-1",
          expiresAt: null,
          activatesAt: null,
          remaining: 10n,
        },
        {
          id: "uncovered-0",
          referenceId: "member:user-1:in_uncovered:subscription",
          organizationId: "org-1",
          userId: "user-1",
          expiresAt: null,
          activatesAt: null,
          remaining: 0n,
        },
        {
          id: "unparseable-0",
          referenceId: "member:user-1:not-a-period-ref",
          organizationId: "org-1",
          userId: "user-1",
          expiresAt: null,
          activatesAt: null,
          remaining: 0n,
        },
      ]),
      creditBucket: {
        findUnique: findUniqueMock,
        deleteMany: deleteManyMock,
      },
    };

    const result = await deleteCoveredMemberPeriodTombstones(prisma as never);

    assert.equal(result.candidates, 4);
    assert.equal(result.deleted, 1);
    assert.equal(result.skippedRemainingPositive, 1);
    assert.equal(result.skippedUncovered, 1);
    assert.equal(result.skippedUnparseable, 1);
    assert.deepEqual(deleteManyMock.mock.calls[0]?.[0].where, {
      id: { in: ["covered-0"] },
    });
  });

  it("dryRun reports would-delete without deleting", async () => {
    const deleteManyMock = vi.fn();
    const prisma = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: "covered-0",
          referenceId: "member:user-1:in_covered:subscription",
          organizationId: "org-1",
          userId: "user-1",
          expiresAt: null,
          activatesAt: null,
          remaining: 0n,
        },
      ]),
      creditBucket: {
        findUnique: vi.fn().mockResolvedValue({ id: "sentinel" }),
        deleteMany: deleteManyMock,
      },
    };

    const result = await deleteCoveredMemberPeriodTombstones(prisma as never, {
      dryRun: true,
    });

    assert.equal(result.deleted, 1);
    assert.equal(deleteManyMock.mock.calls.length, 0);
  });
});

describe("orgPeriodFingerprintExists", () => {
  it("checks exact referenceId_referenceType unique key", async () => {
    const findUniqueMock = vi.fn().mockResolvedValue({ id: "x" });
    const exists = await orgPeriodFingerprintExists(
      { creditBucket: { findUnique: findUniqueMock } } as never,
      "org:org-1:in_1:subscription",
    );
    assert.equal(exists, true);
    assert.deepEqual(findUniqueMock.mock.calls[0]?.[0].where, {
      referenceId_referenceType: {
        referenceId: "org:org-1:in_1:subscription",
        referenceType: CreditBucketReferenceType.STRIPE_SUBSCRIPTION_PERIOD,
      },
    });
  });
});
