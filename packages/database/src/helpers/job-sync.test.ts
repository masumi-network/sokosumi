import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  AgentJobStatus,
  AgentStatus,
  JobType,
  OnChainJobStatus,
  type Prisma,
} from "../generated/prisma/client.js";
import { finalizedOnChainJobStatuses } from "../types/job.js";
import {
  buildJobsNeedingAgentStatusSyncWhere,
  buildJobsNeedingPurchaseSyncWhere,
  buildJobsPendingLocalRefundWhere,
  FREE_JOB_OFFLINE_SYNC_WINDOW_MS,
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

function expectPaymentDeadlineAfterCutoffOr(
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
    createdAt: { gt: Date };
  };
  assert.ok(withPayByTime.payByTime);
  assert.equal(
    (withPayByTime.payByTime as Prisma.DateTimeNullableFilter<"Job">).not,
    null,
  );
  assert.ok(
    (withPayByTime.payByTime as Prisma.DateTimeNullableFilter<"Job">)
      .gt instanceof Date,
  );
  assert.equal(withCreatedAtFallback.payByTime, null);
  assert.ok(withCreatedAtFallback.createdAt.gt instanceof Date);
}

describe("buildJobsPendingLocalRefundWhere", () => {
  it("selects refund terminal states and timed-out missing purchases", () => {
    const where = buildJobsPendingLocalRefundWhere();
    const orClauses = where.OR as Prisma.JobWhereInput[];
    const terminalStatusClause = orClauses.find(
      (clause) =>
        clause.purchase !== null &&
        typeof clause.purchase === "object" &&
        "onChainStatus" in clause.purchase &&
        clause.purchase.onChainStatus !== null &&
        typeof clause.purchase.onChainStatus === "object" &&
        "in" in clause.purchase.onChainStatus,
    );
    const missingPurchaseClause = orClauses.find(
      (clause) => clause.purchase === null,
    );

    assert.equal(where.refundedTransactionId, null);
    assert.equal(where.jobType, JobType.PAID);
    assert.deepEqual(terminalStatusClause?.purchase, {
      onChainStatus: {
        in: [
          OnChainJobStatus.REFUND_WITHDRAWN,
          OnChainJobStatus.FUNDS_OR_DATUM_INVALID,
        ],
      },
    });
    assert.equal(missingPurchaseClause?.purchase, null);
    expectPaymentDeadlineBeforeCutoffOr(missingPurchaseClause);
    assert.equal(
      orClauses.some(
        (clause) =>
          clause.purchase !== null &&
          typeof clause.purchase === "object" &&
          "nextActionErrorType" in clause.purchase,
      ),
      false,
    );
    assert.equal(
      orClauses.some(
        (clause) =>
          clause.purchase !== null &&
          typeof clause.purchase === "object" &&
          "onChainStatus" in clause.purchase &&
          clause.purchase.onChainStatus === OnChainJobStatus.DISPUTED_WITHDRAWN,
      ),
      false,
    );
  });
});

describe("buildJobsNeedingPurchaseSyncWhere", () => {
  it("keeps unresolved paid jobs and fresh missing purchases in the purchase sync set", () => {
    const where = buildJobsNeedingPurchaseSyncWhere();
    const orClauses = where.OR as Prisma.JobWhereInput[];
    const unresolvedPurchaseClause = orClauses.find(
      (clause) =>
        clause.purchase !== null &&
        typeof clause.purchase === "object" &&
        "onChainStatus" in clause.purchase &&
        clause.purchase.onChainStatus !== null &&
        typeof clause.purchase.onChainStatus === "object" &&
        "notIn" in clause.purchase.onChainStatus,
    );
    const nullOnChainClause = orClauses.find(
      (clause) =>
        clause.purchase !== null &&
        typeof clause.purchase === "object" &&
        "onChainStatus" in clause.purchase &&
        clause.purchase.onChainStatus === null,
    );
    const missingPurchaseClause = orClauses.find(
      (clause) => clause.purchase === null,
    );

    assert.equal(where.jobType, JobType.PAID);
    assert.deepEqual(unresolvedPurchaseClause?.purchase, {
      onChainStatus: {
        notIn: finalizedOnChainJobStatuses,
      },
    });
    assert.deepEqual(nullOnChainClause?.purchase, {
      onChainStatus: null,
    });
    assert.equal(missingPurchaseClause?.purchase, null);
    expectPaymentDeadlineAfterCutoffOr(missingPurchaseClause);
  });

  it("excludes purchases neither disputed nor refund-requested when external dispute unlock is before the cutoff", () => {
    const where = buildJobsNeedingPurchaseSyncWhere();
    const notClauses = where.NOT as Prisma.JobWhereInput[];
    const disputeWindowClause = notClauses[0] as {
      purchase?: Prisma.JobPurchaseWhereInput;
      externalDisputeUnlockTime?: Prisma.DateTimeNullableFilter<"Job">;
    };

    assert.equal(notClauses.length, 1);
    assert.deepEqual(disputeWindowClause.purchase, {
      onChainStatus: {
        notIn: [
          OnChainJobStatus.DISPUTED,
          OnChainJobStatus.REFUND_REQUESTED,
          OnChainJobStatus.REFUND_AUTHORIZED,
          OnChainJobStatus.WITHDRAW_AUTHORIZED,
        ],
        not: null,
      },
    });
    assert.deepEqual(disputeWindowClause.externalDisputeUnlockTime, {
      not: null,
      lt: (
        disputeWindowClause.externalDisputeUnlockTime as {
          lt: Date;
        }
      ).lt,
    });
    assert.ok(
      (disputeWindowClause.externalDisputeUnlockTime as { lt: Date })
        .lt instanceof Date,
    );
  });
});

describe("buildJobsNeedingAgentStatusSyncWhere", () => {
  it("keeps free and paid jobs with unfinished agent work in the agent sync set", () => {
    const now = new Date("2026-07-28T12:00:00.000Z");
    const where = buildJobsNeedingAgentStatusSyncWhere(now);

    const freeJobCutoff = new Date(
      now.getTime() - FREE_JOB_OFFLINE_SYNC_WINDOW_MS,
    );
    // Snapshot-backed jobs keep polling when the stable Agent row advances to
    // an offline revision. Both bypasses are time-bounded.
    assert.deepEqual(where.OR, [
      { agent: { status: AgentStatus.ONLINE } },
      {
        OR: [
          {
            jobType: JobType.PAID,
            externalDisputeUnlockTime: { gt: now },
          },
          {
            jobType: JobType.FREE,
            agentApiBaseUrl: { not: null },
            createdAt: { gt: freeJobCutoff },
          },
        ],
      },
    ]);
    assert.deepEqual(where.jobType, {
      in: [JobType.FREE, JobType.PAID],
    });
    assert.deepEqual(where.events, {
      none: {
        status: {
          in: [AgentJobStatus.COMPLETED, AgentJobStatus.FAILED],
        },
      },
    });
  });

  it("moves disputed, refund, invalid-funds, and refunded paid jobs out of the agent sync set", () => {
    const where = buildJobsNeedingAgentStatusSyncWhere();
    const notClauses = where.NOT as Prisma.JobWhereInput[];

    assert.equal(notClauses.length, 2);
    assert.deepEqual(notClauses[0], {
      jobType: JobType.PAID,
      purchase: {
        onChainStatus: {
          in: [
            OnChainJobStatus.DISPUTED,
            OnChainJobStatus.REFUND_REQUESTED,
            OnChainJobStatus.REFUND_AUTHORIZED,
            OnChainJobStatus.REFUND_WITHDRAWN,
            OnChainJobStatus.DISPUTED_WITHDRAWN,
            OnChainJobStatus.FUNDS_OR_DATUM_INVALID,
          ],
        },
      },
    });
    assert.deepEqual(notClauses[1], {
      jobType: JobType.PAID,
      refundedTransactionId: {
        not: null,
      },
    });
  });
});
