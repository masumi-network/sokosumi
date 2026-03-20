import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  JobType,
  OnChainJobStatus,
  type Prisma,
} from "../generated/prisma/client.js";
import { ACTIVE_PURCHASE_NEXT_ACTIONS } from "./job.js";
import {
  buildJobsNeedingRemoteSyncWhere,
  buildJobsPendingLocalRefundWhere,
} from "./job-sync.js";

function expectPaymentDeadlineBeforeCutoffOr(
  clause: Prisma.JobWhereInput | undefined,
): void {
  assert.ok(clause?.OR);
  const or = clause.OR as Prisma.JobWhereInput[];
  assert.equal(or.length, 2);
  const withPayByTime = or[0] as {
    payByTime?: Prisma.DateTimeNullableFilter<"Job">;
  };
  const withCreatedAtFallback = or[1] as {
    payByTime: null;
    createdAt: { lt: Date };
  };
  assert.ok(withPayByTime.payByTime);
  assert.equal(
    (withPayByTime.payByTime as Prisma.DateTimeNullableFilter<"Job">).not,
    null,
  );
  assert.ok(
    (withPayByTime.payByTime as Prisma.DateTimeNullableFilter<"Job">)
      .lt instanceof Date,
  );
  assert.equal(withCreatedAtFallback.payByTime, null);
  assert.ok(withCreatedAtFallback.createdAt.lt instanceof Date);
}

describe("buildJobsPendingLocalRefundWhere", () => {
  it("selects paid jobs missing a local refund transaction for refund terminal states and timed-out missing purchases", () => {
    const where = buildJobsPendingLocalRefundWhere();
    const orClauses = where.OR as Prisma.JobWhereInput[];
    const missingPurchaseClause = orClauses.find(
      (clause) => clause.purchase === null,
    );
    const purchaseActionErrorClause = orClauses.find(
      (clause) =>
        clause.purchase !== null &&
        typeof clause.purchase === "object" &&
        "nextActionErrorType" in clause.purchase,
    );
    const timedOutNullOnChainClause = orClauses.find(
      (clause) =>
        clause.purchase !== null &&
        typeof clause.purchase === "object" &&
        "onChainStatus" in clause.purchase &&
        clause.purchase.onChainStatus === null &&
        "nextAction" in clause.purchase,
    );

    assert.equal(where.refundedTransactionId, null);
    assert.equal(where.jobType, JobType.PAID);
    assert.equal(
      orClauses.some(
        (clause) =>
          clause.purchase !== null &&
          typeof clause.purchase === "object" &&
          "onChainStatus" in clause.purchase &&
          clause.purchase.onChainStatus === OnChainJobStatus.REFUND_WITHDRAWN,
      ),
      true,
    );
    assert.equal(
      orClauses.some(
        (clause) =>
          clause.purchase !== null &&
          typeof clause.purchase === "object" &&
          "onChainStatus" in clause.purchase &&
          clause.purchase.onChainStatus ===
            OnChainJobStatus.FUNDS_OR_DATUM_INVALID,
      ),
      true,
    );
    assert.equal(missingPurchaseClause?.purchase, null);
    expectPaymentDeadlineBeforeCutoffOr(missingPurchaseClause);
    assert.deepEqual(purchaseActionErrorClause?.purchase, {
      onChainStatus: null,
      nextActionErrorType: {
        not: null,
      },
    });
    assert.deepEqual(timedOutNullOnChainClause?.purchase, {
      onChainStatus: null,
      nextAction: {
        notIn: ACTIVE_PURCHASE_NEXT_ACTIONS,
      },
    });
    expectPaymentDeadlineBeforeCutoffOr(timedOutNullOnChainClause);
  });
});

describe("buildJobsNeedingRemoteSyncWhere", () => {
  it("does not include refund withdrawals in the unfinished sync set", () => {
    const where = buildJobsNeedingRemoteSyncWhere();
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

  it("keeps refund requests past the dispute cutoff in the unfinished sync set", () => {
    const where = buildJobsNeedingRemoteSyncWhere();
    const notClauses = where.NOT as Prisma.JobWhereInput[];
    const fundsInvalidClause = notClauses.find(
      (clause) =>
        clause.purchase !== null &&
        typeof clause.purchase === "object" &&
        "onChainStatus" in clause.purchase &&
        clause.purchase.onChainStatus ===
          OnChainJobStatus.FUNDS_OR_DATUM_INVALID,
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

  it("moves purchase-action errors out of the unfinished sync set", () => {
    const where = buildJobsNeedingRemoteSyncWhere();
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

  it("keeps active timed-out null-on-chain purchases in the unfinished sync set", () => {
    const where = buildJobsNeedingRemoteSyncWhere();
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
    expectPaymentDeadlineBeforeCutoffOr(timedOutNullOnChainClause);
  });

  it("moves timed-out missing purchases out of the unfinished sync set", () => {
    const where = buildJobsNeedingRemoteSyncWhere();
    const notClauses = where.NOT as Prisma.JobWhereInput[];
    const missingPurchaseClause = notClauses.find(
      (clause) => clause.purchase === null,
    );

    assert.equal(missingPurchaseClause?.purchase, null);
    assert.equal(missingPurchaseClause?.jobType, JobType.PAID);
    expectPaymentDeadlineBeforeCutoffOr(missingPurchaseClause);
  });
});
