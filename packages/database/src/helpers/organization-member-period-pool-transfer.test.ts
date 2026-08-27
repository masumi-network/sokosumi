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
          expiresAt: new Date("2026-09-01T00:00:00.000Z"),
          organizationId: "org-1",
          remaining: 60n,
        },
        {
          id: "b-2",
          amount: 50n,
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
    assert.equal(createTransactionMock.mock.calls.length, 4);

    interface MigratedGrant {
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

    assert.equal(grantAmounts.length, 2);
    assert.deepEqual(
      grantAmounts
        .map((grant) => ({
          amount: grant.amount,
          expiresAt: grant.expiresAt.toISOString(),
          userId: grant.userId,
        }))
        .toSorted((left, right) =>
          left.expiresAt.localeCompare(right.expiresAt),
        ),
      [
        {
          amount: 50n,
          expiresAt: "2026-08-01T00:00:00.000Z",
          userId: null,
        },
        {
          amount: 60n,
          expiresAt: "2026-09-01T00:00:00.000Z",
          userId: null,
        },
      ],
    );
  });
});
