import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CreditBucketReferenceType,
  JobType,
  OnChainJobStatus,
  type Prisma,
} from "../../generated/prisma/client.js";
import { jobRepository } from "../job.repository.js";

async function captureGetJobsNotFinishedWhereQuery() {
  let where: Prisma.JobWhereInput | undefined;

  const tx = {
    job: {
      findMany: async (args: { where: Prisma.JobWhereInput }) => {
        where = args.where;
        return [];
      },
    },
  } as unknown as Prisma.TransactionClient;

  await jobRepository.getJobsNotFinished(tx);

  assert.ok(where);
  return where;
}

async function captureGetJobsPendingRefundReconciliationWhereQuery() {
  let where: Prisma.JobWhereInput | undefined;

  const tx = {
    job: {
      findMany: async (args: { where: Prisma.JobWhereInput }) => {
        where = args.where;
        return [];
      },
    },
  } as unknown as Prisma.TransactionClient;

  await jobRepository.getJobsPendingRefundReconciliation(tx);

  assert.ok(where);
  return where;
}

describe("jobRepository.getJobsNotFinished", () => {
  it("does not include refund withdrawals in the unfinished sync set", async () => {
    const where = await captureGetJobsNotFinishedWhereQuery();
    const orClauses = where.OR as Prisma.JobWhereInput[];

    const hasRefundWithdrawalReinclusion = orClauses.some((clause) => {
      const purchase = clause.purchase as
        | { onChainStatus?: { in?: OnChainJobStatus[] } }
        | undefined;
      return purchase?.onChainStatus?.in?.includes(
        OnChainJobStatus.REFUND_WITHDRAWN,
      );
    });

    assert.equal(hasRefundWithdrawalReinclusion, false);
  });

  it("keeps refund requests past the dispute cutoff in the unfinished sync set", async () => {
    const where = await captureGetJobsNotFinishedWhereQuery();
    const notClauses = where.NOT as Prisma.JobWhereInput[];

    assert.deepEqual(notClauses.at(1)?.purchase, {
      onChainStatus: {
        notIn: [OnChainJobStatus.DISPUTED, OnChainJobStatus.REFUND_REQUESTED],
      },
    });
  });
});

describe("jobRepository.getJobsPendingRefundReconciliation", () => {
  it("returns only paid jobs with refund withdrawn and no local refund transaction", async () => {
    const where = await captureGetJobsPendingRefundReconciliationWhereQuery();

    assert.deepEqual(
      where,
      {
        purchase: {
          onChainStatus: OnChainJobStatus.REFUND_WITHDRAWN,
        },
        refundedTransactionId: null,
        jobType: JobType.PAID,
      } satisfies Prisma.JobWhereInput,
    );
  });
});

describe("jobRepository.refundJob", () => {
  it("creates a refund bucket with REFUND reference type and no expiry", async () => {
    const updateCalls: unknown[] = [];
    const tx = {
      job: {
        findUnique: async () => ({
          refundedTransaction: null,
          transaction: {
            amount: -500n,
            organizationId: "org-1",
            userId: "user-1",
          },
        }),
        update: async (args: unknown) => {
          updateCalls.push(args);
          return {};
        },
      },
    } as unknown as Prisma.TransactionClient;

    await jobRepository.refundJob("job-1", tx);

    assert.equal(updateCalls.length, 1);

    const updateCall = updateCalls[0] as {
      data: {
        refundedTransaction: {
          create: {
            amount: bigint;
            organization?: { connect: { id: string } };
            sourceCreditBucket: {
              create: {
                expiresAt: Date | null;
                referenceId: string;
                referenceType: CreditBucketReferenceType;
              };
            };
          };
        };
      };
      where: { id: string };
    };

    assert.equal(updateCall.where.id, "job-1");
    assert.equal(updateCall.data.refundedTransaction.create.amount, 500n);
    assert.equal(
      updateCall.data.refundedTransaction.create.sourceCreditBucket.create
        .referenceId,
      "job-1",
    );
    assert.equal(
      updateCall.data.refundedTransaction.create.sourceCreditBucket.create
        .referenceType,
      CreditBucketReferenceType.REFUND,
    );
    assert.equal(
      updateCall.data.refundedTransaction.create.organization?.connect.id,
      "org-1",
    );

    assert.equal(
      updateCall.data.refundedTransaction.create.sourceCreditBucket.create
        .expiresAt,
      null,
    );
  });

  it("does nothing when job is already refunded", async () => {
    let updateCalled = false;
    const tx = {
      job: {
        findUnique: async () => ({
          refundedTransaction: { id: "refund-1" },
          transaction: {
            amount: -500n,
            organizationId: null,
            userId: "user-1",
          },
        }),
        update: async () => {
          updateCalled = true;
          return {};
        },
      },
    } as unknown as Prisma.TransactionClient;

    await jobRepository.refundJob("job-1", tx);

    assert.equal(updateCalled, false);
  });

  it("throws when the original transaction is missing", async () => {
    const tx = {
      job: {
        findUnique: async () => ({
          refundedTransaction: null,
          transaction: null,
        }),
        update: async () => ({}),
      },
    } as unknown as Prisma.TransactionClient;

    await assert.rejects(
      () => jobRepository.refundJob("job-1", tx),
      /Transaction not found/,
    );
  });
});
