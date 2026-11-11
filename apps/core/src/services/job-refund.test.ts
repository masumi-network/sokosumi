import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import { refundJob } from "./job-refund";

const PROJECT_ID = "22222222-2222-7222-8222-222222222222";

function jobTx(
  job: unknown,
  { liveCuso = true, remaining = [] as unknown[] } = {},
) {
  const update = vi.fn().mockResolvedValue({});
  const transactionCreate = vi.fn(async () => ({
    id: `refund-${transactionCreate.mock.calls.length}`,
  }));
  const tx = {
    job: { findUnique: async () => job, update },
    transaction: { create: transactionCreate },
    sokoBot: {
      findFirst: vi.fn().mockResolvedValue(liveCuso ? { id: "cuso" } : null),
    },
    $queryRaw: vi.fn().mockResolvedValue(remaining),
  } as unknown as Prisma.TransactionClient;
  const created = () =>
    transactionCreate.mock.calls.map(
      (call) =>
        (
          call as unknown as [{ data: Prisma.TransactionUncheckedCreateInput }]
        )[0].data,
    );
  return { tx, update, created };
}

function spend(overrides: Record<string, unknown> = {}) {
  return {
    refundedTransaction: null,
    transaction: {
      amount: -500n,
      organizationId: "org-1",
      userId: "user-1",
      creditConsumptions: [{ amount: 500n, bucket: { projectId: PROJECT_ID } }],
      ...overrides,
    },
  };
}

describe("refundJob", () => {
  it("creates a refund bucket with REFUND reference type and no expiry, linked to the job", async () => {
    const { tx, update, created } = jobTx(spend());

    await refundJob("job-1", tx);

    expect(created()).toEqual([
      {
        amount: 500n,
        organizationId: "org-1",
        userId: null,
        sourceCreditBucket: {
          create: {
            amount: 500n,
            referenceId: "job-1",
            referenceType: CreditBucketReferenceType.REFUND,
            expiresAt: null,
            userId: null,
            organizationId: "org-1",
            // Back to the Project the charge spent its Project credits from.
            projectId: PROJECT_ID,
          },
        },
      },
    ]);
    expect(update).toHaveBeenCalledExactlyOnceWith({
      where: { id: "job-1" },
      data: { refundedTransaction: { connect: { id: "refund-1" } } },
    });
  });

  it("splits a mixed refund: 10 back to the Project, 90 back to the pool", async () => {
    const { tx, created } = jobTx(
      spend({
        amount: -100n,
        creditConsumptions: [
          { amount: 10n, bucket: { projectId: PROJECT_ID } },
          { amount: 90n, bucket: { projectId: null } },
        ],
      }),
    );

    await refundJob("job-1", tx);

    expect(
      created().map((data) => data.sourceCreditBucket?.create),
    ).toMatchObject([
      { amount: 10n, projectId: PROJECT_ID },
      { amount: 90n, projectId: null },
    ]);
  });

  it("writes the Project part off when the Project has no live Cuso", async () => {
    const { tx, created } = jobTx(spend(), {
      liveCuso: false,
      remaining: [
        {
          id: "bucket-r",
          organizationId: "org-1",
          userId: null,
          remaining: 500n,
        },
      ],
    });

    await refundJob("job-1", tx);

    expect(created().map((data) => data.amount)).toEqual([500n, -500n]);
    expect(created()[1]).toMatchObject({
      creditConsumptions: { create: { amount: 500n, bucketId: "bucket-r" } },
    });
  });

  it("stamps a personal refund bucket with the actor", async () => {
    const { tx, created } = jobTx(
      spend({
        organizationId: null,
        creditConsumptions: [{ amount: 500n, bucket: { projectId: null } }],
      }),
    );

    await refundJob("job-1", tx);

    expect(created()[0]).toMatchObject({
      userId: "user-1",
      organizationId: null,
      sourceCreditBucket: {
        create: { userId: "user-1", organizationId: null, projectId: null },
      },
    });
  });

  it("does nothing when job is already refunded", async () => {
    const { tx, update, created } = jobTx({
      ...spend(),
      refundedTransaction: { id: "refund-1" },
    });

    await refundJob("job-1", tx);

    expect(update).not.toHaveBeenCalled();
    expect(created()).toEqual([]);
  });

  it("throws when the original transaction is missing", async () => {
    const { tx } = jobTx({ refundedTransaction: null, transaction: null });

    await expect(refundJob("job-1", tx)).rejects.toThrow(
      /Transaction not found/,
    );
  });
});
