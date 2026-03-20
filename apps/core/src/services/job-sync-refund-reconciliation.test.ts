import { JobType, OnChainJobStatus, type Prisma } from "@sokosumi/database";
import { ACTIVE_PURCHASE_NEXT_ACTIONS } from "@sokosumi/database/helpers";
import { describe, expect, it } from "vitest";

import { buildJobsPendingRefundReconciliationWhere } from "./job-sync-refund-reconciliation";

function expectPayByTimeCutoffFilter(
  payByTime: Prisma.JobWhereInput["payByTime"] | undefined,
): void {
  expect(payByTime).toBeDefined();
  const filter = payByTime as Prisma.DateTimeNullableFilter<"Job">;
  expect(filter.not).toBeNull();
  expect(filter.lt).toBeInstanceOf(Date);
}

describe("buildJobsPendingRefundReconciliationWhere", () => {
  it("selects paid jobs missing a local refund transaction for refund terminal states and timed-out missing purchases", () => {
    const where = buildJobsPendingRefundReconciliationWhere();
    const orClauses = where.OR as Prisma.JobWhereInput[];
    const missingPurchaseClause = orClauses.find(
      (clause) => clause.purchase === null,
    );
    const timedOutNullOnChainClause = orClauses.find(
      (clause) =>
        clause.purchase &&
        "onChainStatus" in clause.purchase &&
        clause.purchase.onChainStatus === null,
    );

    expect(where.refundedTransactionId).toBeNull();
    expect(where.jobType).toBe(JobType.PAID);
    expect(
      orClauses.some(
        (clause) =>
          clause.purchase &&
          "onChainStatus" in clause.purchase &&
          clause.purchase.onChainStatus === OnChainJobStatus.REFUND_WITHDRAWN,
      ),
    ).toBe(true);
    expect(
      orClauses.some(
        (clause) =>
          clause.purchase &&
          "onChainStatus" in clause.purchase &&
          clause.purchase.onChainStatus ===
            OnChainJobStatus.FUNDS_OR_DATUM_INVALID,
      ),
    ).toBe(true);
    expect(missingPurchaseClause?.purchase).toBeNull();
    expectPayByTimeCutoffFilter(missingPurchaseClause?.payByTime);
    expect(timedOutNullOnChainClause?.purchase).toEqual({
      onChainStatus: null,
      nextAction: {
        notIn: ACTIVE_PURCHASE_NEXT_ACTIONS,
      },
    });
    expectPayByTimeCutoffFilter(timedOutNullOnChainClause?.payByTime);
  });
});
