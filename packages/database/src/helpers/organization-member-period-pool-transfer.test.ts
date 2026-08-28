import assert from "node:assert/strict";

import { describe, it, vi } from "vitest";

import { transferMemberPeriodBucketsToOrganizationPool } from "./organization-member-period-pool-transfer.js";

describe("transferMemberPeriodBucketsToOrganizationPool", () => {
  it("drains leftover member period buckets into org-owned buckets per expiry", async () => {
    const createTransactionMock = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: "b-1",
          amount: 100n,
          activatesAt: null,
          expiresAt: new Date("2026-09-01T00:00:00.000Z"),
          organizationId: "org-1",
          remaining: 60n,
        },
        {
          id: "b-2",
          amount: 50n,
          activatesAt: null,
          expiresAt: new Date("2026-08-01T00:00:00.000Z"),
          organizationId: "org-1",
          remaining: 50n,
        },
      ]),
      member: {
        findFirst: vi.fn().mockResolvedValue({ userId: "owner-1" }),
      },
      transaction: {
        create: createTransactionMock,
      },
    };

    const result = await transferMemberPeriodBucketsToOrganizationPool(
      tx as never,
      undefined,
      new Date("2026-07-01T00:00:00.000Z"),
    );

    assert.equal(result.organizations, 1);
    assert.equal(result.bucketsDrained, 2);
    assert.equal(result.centsTransferred, 110n);
    assert.equal(result.skippedNoActor, 0);
    assert.equal(createTransactionMock.mock.calls.length, 4);

    interface MigratedGrant {
      activatesAt: Date | null;
      amount: bigint;
      expiresAt: Date;
      userId: string | null;
    }

    const grantAmounts: MigratedGrant[] = createTransactionMock.mock.calls
      .filter(
        (
          call: [
            {
              data: {
                sourceCreditBucket?: {
                  create: {
                    activatesAt: Date | null;
                    amount: bigint;
                    expiresAt: Date;
                    userId: string | null;
                  };
                };
              };
            },
          ],
        ) => call[0].data.sourceCreditBucket != null,
      )
      .map(
        (
          call: [
            {
              data: {
                sourceCreditBucket: {
                  create: {
                    activatesAt: Date | null;
                    amount: bigint;
                    expiresAt: Date;
                    userId: string | null;
                  };
                };
              };
            },
          ],
        ) => call[0].data.sourceCreditBucket.create,
      );

    const drainAmounts = createTransactionMock.mock.calls
      .filter(
        (
          call: [
            {
              data: {
                creditConsumptions?: {
                  createMany: { data: Array<{ amount: bigint }> };
                };
              };
            },
          ],
        ) => call[0].data.creditConsumptions != null,
      )
      .flatMap(
        (
          call: [
            {
              data: {
                creditConsumptions: {
                  createMany: {
                    data: Array<{ amount: bigint; bucketId: string }>;
                  };
                };
              };
            },
          ],
        ) => call[0].data.creditConsumptions.createMany.data,
      );
    assert.deepEqual(
      drainAmounts
        .map((row: { amount: bigint; bucketId: string }) => ({
          amount: row.amount,
          bucketId: row.bucketId,
        }))
        .toSorted((left: { bucketId: string }, right: { bucketId: string }) =>
          left.bucketId.localeCompare(right.bucketId),
        ),
      [
        { amount: 60n, bucketId: "b-1" },
        { amount: 50n, bucketId: "b-2" },
      ].toSorted((left, right) => left.bucketId.localeCompare(right.bucketId)),
    );

    assert.equal(grantAmounts.length, 2);
    assert.deepEqual(
      grantAmounts
        .map((grant) => ({
          activatesAt: grant.activatesAt,
          amount: grant.amount,
          expiresAt: grant.expiresAt.toISOString(),
          userId: grant.userId,
        }))
        .toSorted((left, right) =>
          left.expiresAt.localeCompare(right.expiresAt),
        ),
      [
        {
          activatesAt: null,
          amount: 50n,
          expiresAt: "2026-08-01T00:00:00.000Z",
          userId: null,
        },
        {
          activatesAt: null,
          amount: 60n,
          expiresAt: "2026-09-01T00:00:00.000Z",
          userId: null,
        },
      ],
    );
  });

  it("copies future activatesAt onto the org-owned bucket", async () => {
    const createTransactionMock = vi.fn();
    const activatesAt = new Date("2026-09-01T00:00:00.000Z");
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: "b-future",
          amount: 250n,
          activatesAt,
          expiresAt: new Date("2026-10-01T00:00:00.000Z"),
          organizationId: "org-1",
          remaining: 250n,
        },
      ]),
      member: {
        findFirst: vi.fn().mockResolvedValue({ userId: "owner-1" }),
      },
      transaction: {
        create: createTransactionMock,
      },
    };

    await transferMemberPeriodBucketsToOrganizationPool(
      tx as never,
      "org-1",
      new Date("2026-07-01T00:00:00.000Z"),
    );

    const grant = createTransactionMock.mock.calls.find(
      (
        call: [
          { data: { sourceCreditBucket?: { create: { activatesAt: Date } } } },
        ],
      ) => call[0].data.sourceCreditBucket != null,
    )?.[0].data.sourceCreditBucket.create;
    assert.equal(grant?.activatesAt, activatesAt);
    assert.equal(grant?.userId, null);
  });

  it("skips leftover remaining when the organization has no members", async () => {
    const createTransactionMock = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([
        {
          id: "b-1",
          amount: 50n,
          activatesAt: null,
          expiresAt: new Date("2026-09-01T00:00:00.000Z"),
          organizationId: "org-orphan",
          remaining: 50n,
        },
      ]),
      member: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
      transaction: {
        create: createTransactionMock,
      },
    };

    const result = await transferMemberPeriodBucketsToOrganizationPool(
      tx as never,
      "org-orphan",
      new Date("2026-07-01T00:00:00.000Z"),
    );

    assert.equal(result.skippedNoActor, 1);
    assert.equal(result.bucketsDrained, 0);
    assert.equal(createTransactionMock.mock.calls.length, 0);
  });

  it("queries leftover member-period remaining without deleting old rows", async () => {
    const queryRawMock = vi.fn().mockResolvedValue([]);
    const tx = {
      $queryRaw: queryRawMock,
      member: {
        findFirst: vi.fn(),
      },
      transaction: {
        create: vi.fn(),
      },
      creditBucket: {
        delete: vi.fn(),
        deleteMany: vi.fn(),
        update: vi.fn(),
      },
    };

    const result = await transferMemberPeriodBucketsToOrganizationPool(
      tx as never,
      "org-1",
      new Date("2026-07-01T00:00:00.000Z"),
    );

    assert.equal(result.bucketsDrained, 0);
    assert.equal(result.centsTransferred, 0n);
    assert.equal(tx.creditBucket.delete.mock.calls.length, 0);
    assert.equal(tx.creditBucket.deleteMany.mock.calls.length, 0);
    assert.equal(tx.creditBucket.update.mock.calls.length, 0);

    const sql = JSON.stringify(queryRawMock.mock.calls[0]);
    assert.match(sql, /member:/);
    assert.match(sql, /userId/);
    assert.match(sql, /STRIPE_SUBSCRIPTION_PERIOD/);
  });

  it("is a no-op when leftover remaining is already 0", async () => {
    const createTransactionMock = vi.fn();
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      member: {
        findFirst: vi.fn().mockResolvedValue({ userId: "owner-1" }),
      },
      transaction: {
        create: createTransactionMock,
      },
    };

    const result = await transferMemberPeriodBucketsToOrganizationPool(
      tx as never,
      "org-1",
      new Date("2026-07-01T00:00:00.000Z"),
    );

    assert.equal(result.bucketsDrained, 0);
    assert.equal(result.centsTransferred, 0n);
    assert.equal(createTransactionMock.mock.calls.length, 0);
  });
});
