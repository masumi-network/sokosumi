import assert from "node:assert/strict";

import { describe, it, vi } from "vitest";

import { transferMemberPeriodBucketsToOrganizationPool } from "./organization-member-period-pool-transfer.js";

describe("transferMemberPeriodBucketsToOrganizationPool", () => {
  it("drains leftover member period buckets into one org-owned period bucket", async () => {
    const createTransactionMock = vi.fn();
    const tx = {
      creditBucket: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "b-1",
            amount: 100n,
            expiresAt: new Date("2026-09-01T00:00:00.000Z"),
            organizationId: "org-1",
            creditConsumptions: [{ amount: 40n }],
          },
          {
            id: "b-2",
            amount: 50n,
            expiresAt: new Date("2026-08-01T00:00:00.000Z"),
            organizationId: "org-1",
            creditConsumptions: [],
          },
        ]),
      },
      member: {
        findFirst: vi.fn().mockResolvedValue({ userId: "owner-1" }),
      },
      transaction: {
        create: createTransactionMock,
      },
    };

    const result = await transferMemberPeriodBucketsToOrganizationPool(
      tx as never,
    );

    assert.equal(result.organizations, 1);
    assert.equal(result.bucketsDrained, 2);
    assert.equal(result.centsTransferred, 110n);
    assert.equal(createTransactionMock.mock.calls.length, 2);
    assert.equal(
      createTransactionMock.mock.calls[1]?.[0].data.sourceCreditBucket.create
        .userId,
      null,
    );
    assert.equal(
      createTransactionMock.mock.calls[1]?.[0].data.sourceCreditBucket.create
        .amount,
      110n,
    );
  });
});
