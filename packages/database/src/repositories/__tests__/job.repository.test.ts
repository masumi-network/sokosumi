import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  JobType,
  OnChainJobStatus,
  type Prisma,
} from "../../generated/prisma/client.js";
import { ACTIVE_PURCHASE_NEXT_ACTIONS } from "../../helpers/job.js";
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

function expectPayByTimeCutoffFilter(
  payByTime: Prisma.JobWhereInput["payByTime"] | undefined,
): void {
  assert.ok(payByTime);
  const filter = payByTime as Prisma.DateTimeNullableFilter<"Job">;
  assert.equal(filter.not, null);
  assert.ok(filter.lt instanceof Date);
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
    const fundsInvalidClause = notClauses.find(
      (clause) =>
        clause.purchase !== null &&
        typeof clause.purchase === "object" &&
        "onChainStatus" in clause.purchase &&
        clause.purchase.onChainStatus === OnChainJobStatus.FUNDS_OR_DATUM_INVALID,
    );
    const externalDisputeCutoffClause = notClauses.find(
      (clause) =>
        clause.purchase !== null &&
        typeof clause.purchase === "object" &&
        "onChainStatus" in clause.purchase &&
        clause.purchase.onChainStatus !== null &&
        typeof clause.purchase.onChainStatus === "object" &&
        "notIn" in clause.purchase.onChainStatus,
    );

    assert.deepEqual(fundsInvalidClause?.purchase, {
      onChainStatus: OnChainJobStatus.FUNDS_OR_DATUM_INVALID,
    });
    assert.deepEqual(externalDisputeCutoffClause?.purchase, {
      onChainStatus: {
        notIn: [OnChainJobStatus.DISPUTED, OnChainJobStatus.REFUND_REQUESTED],
      },
    });
  });

  it("moves purchase-action errors out of the unfinished sync set", async () => {
    const where = await captureGetJobsNotFinishedWhereQuery();
    const notClauses = where.NOT as Prisma.JobWhereInput[];
    const purchaseActionErrorClause = notClauses.find(
      (clause) =>
        clause.purchase !== null &&
        typeof clause.purchase === "object" &&
        "nextActionErrorType" in clause.purchase,
    );

    assert.deepEqual(purchaseActionErrorClause?.purchase, {
      onChainStatus: null,
      nextActionErrorType: {
        not: null,
      },
    });
    assert.equal(purchaseActionErrorClause?.jobType, JobType.PAID);
  });

  it("keeps active timed-out null-on-chain purchases in the unfinished sync set", async () => {
    const where = await captureGetJobsNotFinishedWhereQuery();
    const notClauses = where.NOT as Prisma.JobWhereInput[];
    const timedOutNullOnChainClause = notClauses.find(
      (clause) =>
        clause.purchase !== null &&
        typeof clause.purchase === "object" &&
        "onChainStatus" in clause.purchase &&
        clause.purchase.onChainStatus === null &&
        "nextAction" in clause.purchase,
    );

    assert.deepEqual(timedOutNullOnChainClause?.purchase, {
      onChainStatus: null,
      nextAction: {
        notIn: ACTIVE_PURCHASE_NEXT_ACTIONS,
      },
    });
    assert.equal(timedOutNullOnChainClause?.jobType, JobType.PAID);
    expectPayByTimeCutoffFilter(timedOutNullOnChainClause?.payByTime);
  });

  it("moves timed-out missing purchases out of the unfinished sync set", async () => {
    const where = await captureGetJobsNotFinishedWhereQuery();
    const notClauses = where.NOT as Prisma.JobWhereInput[];
    const missingPurchaseClause = notClauses.find(
      (clause) => clause.purchase === null,
    );

    assert.equal(missingPurchaseClause?.purchase, null);
    assert.equal(missingPurchaseClause?.jobType, JobType.PAID);
    expectPayByTimeCutoffFilter(missingPurchaseClause?.payByTime);
  });
});
