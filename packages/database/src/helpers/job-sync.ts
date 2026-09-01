import {
  AgentJobStatus,
  AgentStatus,
  JobType,
  OnChainJobStatus,
} from "../generated/prisma/browser.js";
import type { Prisma } from "../generated/prisma/client.js";

/**
 * Shared grace window (ms) after the effective payment deadline. Used by all
 * job sync selectors and by core job-sync runtime checks so DB selection and
 * in-memory gating stay aligned.
 */
export const JOB_SYNC_PAYMENT_GRACE_MS = 1000 * 60 * 10;
export const FREE_JOB_OFFLINE_SYNC_WINDOW_MS = 1000 * 60 * 60 * 24 * 30;

/**
 * Paid jobs that still have no JobPurchase row, inside the payment grace
 * window. Jobs that already have one are updated from the payment diff feed
 * (job-purchase-diff.service.ts), which needs no per-job selector because the
 * node tells us which purchases changed.
 */
export function buildJobsNeedingPurchaseBackfillWhere(
  cutoffTime: Date = new Date(Date.now() - JOB_SYNC_PAYMENT_GRACE_MS),
): Prisma.JobWhereInput {
  return {
    jobType: JobType.PAID,
    purchase: null,
    OR: [
      { payByTime: { not: null, gt: cutoffTime } },
      { payByTime: null, createdAt: { gt: cutoffTime } },
    ],
  };
}

/**
 * Current transaction fields can change without moving the diff cursor.
 * Bound ordinary states by the dispute deadline plus grace. Refund and dispute
 * actions keep polling until their terminal state because credits depend on it.
 */
export function buildJobsNeedingPurchaseTransactionSyncWhere(
  cutoffTime: Date = new Date(Date.now() - JOB_SYNC_PAYMENT_GRACE_MS),
  legacyCutoffTime: Date = new Date(
    Date.now() - FREE_JOB_OFFLINE_SYNC_WINDOW_MS,
  ),
): Prisma.JobWhereInput {
  return {
    jobType: JobType.PAID,
    purchase: {
      onChainTransactionStatus: { not: null },
    },
    OR: [
      { externalDisputeUnlockTime: { gt: cutoffTime } },
      {
        externalDisputeUnlockTime: null,
        createdAt: { gt: legacyCutoffTime },
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
  };
}

/**
 * Snapshot-backed jobs must keep polling when their stable Agent row advances
 * to an offline revision. Paid jobs use their signed dispute deadline; free
 * jobs have no protocol deadline, so their offline bypass is capped by age.
 *
 * Scoped deliberately: each bypass ends at its deadline, so jobs against
 * permanently dead agents leave the poll set instead of accumulating forever
 * and starving later sync phases.
 */
function buildInFlightAgentSnapshotWhere(now: Date): Prisma.JobWhereInput {
  return {
    OR: [
      {
        jobType: JobType.PAID,
        externalDisputeUnlockTime: { gt: now },
      },
      {
        jobType: JobType.FREE,
        agentApiBaseUrl: { not: null },
        createdAt: {
          gt: new Date(now.getTime() - FREE_JOB_OFFLINE_SYNC_WINDOW_MS),
        },
      },
    ],
  };
}

export function buildJobsNeedingAgentStatusSyncWhere(
  now: Date = new Date(),
): Prisma.JobWhereInput {
  return {
    // Hiring is gated on ONLINE by the availability filter. Here the gate only
    // controls MIP-003 status polling, so it stays in place for dead agents
    // and is bypassed for bounded, snapshot-backed in-flight jobs.
    OR: [
      { agent: { status: AgentStatus.ONLINE } },
      buildInFlightAgentSnapshotWhere(now),
    ],
    jobType: {
      in: [JobType.FREE, JobType.PAID],
    },
    events: {
      none: {
        status: {
          in: [AgentJobStatus.COMPLETED, AgentJobStatus.FAILED],
        },
      },
    },
    NOT: [
      {
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
      },
      {
        jobType: JobType.PAID,
        refundedTransactionId: {
          not: null,
        },
      },
    ],
  };
}

export function buildJobsPendingLocalRefundWhere(
  cutoffTime: Date = new Date(Date.now() - JOB_SYNC_PAYMENT_GRACE_MS),
): Prisma.JobWhereInput {
  return {
    refundedTransactionId: null,
    jobType: JobType.PAID,
    OR: [
      {
        purchase: {
          onChainStatus: {
            in: [
              OnChainJobStatus.REFUND_WITHDRAWN,
              OnChainJobStatus.FUNDS_OR_DATUM_INVALID,
            ],
          },
        },
      },
      {
        purchase: null,
        OR: [
          { payByTime: { not: null, lt: cutoffTime } },
          { payByTime: null, createdAt: { lt: cutoffTime } },
        ],
      },
    ],
  };
}
