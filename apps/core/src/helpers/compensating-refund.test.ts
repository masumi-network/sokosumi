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
  const updateMany = vi.fn().mockResolvedValue({ count: liveCuso ? 1 : 0 });
  const tx = {
    sokoBot: { updateMany },
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
  return { tx, created, queryRaw, updateMany };
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
    const { tx, created, updateMany } = refundTx({
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

    expect(updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        projectId: PROJECT_ID,
        deletedAt: null,
        archivedAt: null,
      }),
      data: { updatedAt: expect.any(Date) },
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

  it("checks the Cuso with a write to his row, so it serializes with an archive", async () => {
    // A FOR UPDATE alone would let a Serializable archive that waited on it
    // proceed on its stale snapshot; a committed write makes it retry.
    const { tx, updateMany } = refundTx();

    await createCompensatingRefund(tx, {
      ...orgRefund,
      consumptions: [{ amount: 100n, bucket: { projectId: PROJECT_ID } }],
    });

    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0]?.[0]).toMatchObject({
      where: { projectId: PROJECT_ID, deletedAt: null, archivedAt: null },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it("keys the linked part by the record and each other part by record and scope", async () => {
    const { tx, created } = refundTx();

    await createCompensatingRefund(tx, {
      ...orgRefund,
      consumptions: [
        { amount: 10n, bucket: { projectId: PROJECT_ID } },
        { amount: 90n, bucket: { projectId: null } },
      ],
    });

    // A bucket's (referenceId, referenceType) is unique; the suffix is how
    // history and usage find the pool part from the linked one.
    expect(
      created.map(({ data }) => data.sourceCreditBucket?.create?.referenceId),
    ).toEqual(["job-1", "job-1#pool"]);
  });
});
