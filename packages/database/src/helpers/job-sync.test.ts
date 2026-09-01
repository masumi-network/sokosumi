import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  AgentJobStatus,
  AgentStatus,
  JobType,
  OnChainJobStatus,
  type Prisma,
} from "../generated/prisma/client.js";
import {
  buildJobsNeedingAgentStatusSyncWhere,
  buildJobsNeedingPurchaseBackfillWhere,
  buildJobsNeedingPurchaseTransactionSyncWhere,
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

describe("buildJobsNeedingPurchaseBackfillWhere", () => {
  it("keeps only paid jobs without a purchase row inside the payment grace window", () => {
    const where = buildJobsNeedingPurchaseBackfillWhere();

    assert.equal(where.jobType, JobType.PAID);
    assert.equal(where.purchase, null);
    assert.equal(where.NOT, undefined);
    expectPaymentDeadlineAfterCutoffOr(where);
  });

  it("uses the caller's cutoff for both deadline branches", () => {
    const cutoff = new Date("2026-01-05T00:00:00.000Z");
    const where = buildJobsNeedingPurchaseBackfillWhere(cutoff);
    const orClauses = where.OR as Prisma.JobWhereInput[];

    assert.deepEqual(orClauses[0], {
      payByTime: { not: null, gt: cutoff },
    });
    assert.deepEqual(orClauses[1], {
      payByTime: null,
      createdAt: { gt: cutoff },
    });
  });
});

describe("buildJobsNeedingPurchaseTransactionSyncWhere", () => {
  it("bounds transaction polls but keeps refund flows alive", () => {
    const cutoff = new Date("2026-01-05T00:00:00.000Z");
    const legacyCutoff = new Date("2025-12-06T00:00:00.000Z");

    assert.deepEqual(
      buildJobsNeedingPurchaseTransactionSyncWhere(cutoff, legacyCutoff),
      {
        jobType: JobType.PAID,
        purchase: {
          onChainTransactionStatus: { not: null },
        },
        OR: [
          { externalDisputeUnlockTime: { gt: cutoff } },
          {
            externalDisputeUnlockTime: null,
            createdAt: { gt: legacyCutoff },
          },
          {
            purchase: {
              onChainStatus: {
                in: [
                  OnChainJobStatus.DISPUTED,
                  OnChainJobStatus.REFUND_REQUESTED,
                  OnChainJobStatus.REFUND_AUTHORIZED,
                  OnChainJobStatus.WITHDRAW_AUTHORIZED,
                ],
              },
            },
          },
        ],
      },
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
