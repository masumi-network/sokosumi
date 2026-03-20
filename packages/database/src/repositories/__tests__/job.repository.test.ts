import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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

    assert.deepEqual(notClauses.at(1)?.purchase, {
      onChainStatus: OnChainJobStatus.FUNDS_OR_DATUM_INVALID,
    });
    assert.deepEqual(notClauses.at(2)?.purchase, {
      onChainStatus: {
        notIn: [OnChainJobStatus.DISPUTED, OnChainJobStatus.REFUND_REQUESTED],
      },
    });
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
