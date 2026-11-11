import { CreditBucketReferenceType, type Prisma } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";

import {
  type CompensatingRefundInput,
  createCompensatingRefund,
} from "./compensating-refund";

const PROJECT_ID = "22222222-2222-7222-8222-222222222222";

/** A tx whose Project has (or has no) live Cuso and these buckets left. */
function refundTx({ liveCuso = true, remaining = [] as unknown[] } = {}) {
  const created: { data: Prisma.TransactionUncheckedCreateInput }[] = [];
  const queryRaw = vi.fn().mockResolvedValue(remaining);
  const findFirst = vi.fn().mockResolvedValue(liveCuso ? { id: "cuso" } : null);
  const tx = {
    sokoBot: { findFirst },
    $queryRaw: queryRaw,
    transaction: {
      create: async (args: {
        data: Prisma.TransactionUncheckedCreateInput;
      }) => {
        created.push(args);
        return { id: `refund-${created.length}` };
      },
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, created, queryRaw, findFirst };
}

const orgRefund: CompensatingRefundInput = {
  amount: 100n,
  actorUserId: "user-1",
  organizationId: "org-1",
  referenceId: "job-1",
  consumptions: [{ amount: 100n, bucket: { projectId: null } }],
};

describe("createCompensatingRefund", () => {
  it("stamps an org refund bucket as org-owned and leaves the transaction without an actor", async () => {
    const { tx, created } = refundTx();

    const id = await createCompensatingRefund(tx, orgRefund);

    expect(id).toBe("refund-1");
    expect(created).toEqual([
      {
        data: {
          amount: 100n,
          organizationId: "org-1",
          userId: null,
          sourceCreditBucket: {
            create: {
              amount: 100n,
              referenceId: "job-1",
              referenceType: CreditBucketReferenceType.REFUND,
              expiresAt: null,
              userId: null,
              organizationId: "org-1",
              projectId: null,
            },
          },
        },
        select: { id: true },
      },
    ]);
  });

  it("stamps a personal refund bucket with the actor and a null organizationId", async () => {
    const { tx, created } = refundTx();

    await createCompensatingRefund(tx, {
      amount: 250n,
      actorUserId: "user-1",
      organizationId: null,
      referenceId: "task-payment:claim-1",
      consumptions: [],
    });

    expect(created).toHaveLength(1);
    expect(created[0]?.data).toMatchObject({
      amount: 250n,
      organizationId: null,
      userId: "user-1",
      sourceCreditBucket: {
        create: {
          amount: 250n,
          userId: "user-1",
          organizationId: null,
          projectId: null,
        },
      },
    });
  });

  it("splits a mixed refund: the Project part to the Project, the pool part to the pool", async () => {
    const { tx, created } = refundTx();

    const id = await createCompensatingRefund(tx, {
      ...orgRefund,
      consumptions: [
        { amount: 10n, bucket: { projectId: PROJECT_ID } },
        { amount: 90n, bucket: { projectId: null } },
      ],
    });

    expect(
      created.map(({ data }) => [
        data.amount,
        data.sourceCreditBucket?.create?.amount,
        data.sourceCreditBucket?.create?.projectId,
      ]),
    ).toEqual([
      [10n, 10n, PROJECT_ID],
      [90n, 90n, null],
    ]);
    // The parent links the Project part, the part its charge drew first.
    expect(id).toBe("refund-1");
  });

  it("refunds a charge that drew only Project credits in one Project bucket", async () => {
    const { tx, created, queryRaw } = refundTx();

    await createCompensatingRefund(tx, {
      ...orgRefund,
      consumptions: [
        { amount: 60n, bucket: { projectId: PROJECT_ID } },
        { amount: 40n, bucket: { projectId: PROJECT_ID } },
      ],
    });

    expect(created).toHaveLength(1);
    expect(created[0]?.data.sourceCreditBucket?.create).toMatchObject({
      amount: 100n,
      projectId: PROJECT_ID,
    });
    // Cuso is live: nothing is written off.
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("writes the Project part off at once when the Project has no live Cuso", async () => {
    const { tx, created, findFirst } = refundTx({
      liveCuso: false,
      remaining: [
        {
          id: "bucket-r",
          organizationId: "org-1",
          userId: null,
          remaining: 10n,
        },
      ],
    });

    await createCompensatingRefund(tx, {
      ...orgRefund,
      consumptions: [
        { amount: 10n, bucket: { projectId: PROJECT_ID } },
        { amount: 90n, bucket: { projectId: null } },
      ],
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        projectId: PROJECT_ID,
        deletedAt: null,
        archivedAt: null,
      }),
      select: { id: true },
    });
    // Refund, pool refund, then the write-off: the refund stays in history.
    expect(created.map(({ data }) => data.amount)).toEqual([10n, 90n, -10n]);
    expect(created[2]?.data).toEqual({
      amount: -10n,
      organizationId: "org-1",
      userId: null,
      creditConsumptions: { create: { amount: 10n, bucketId: "bucket-r" } },
    });
  });
});
