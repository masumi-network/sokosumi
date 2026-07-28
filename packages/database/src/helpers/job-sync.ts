import {
  AgentJobStatus,
  JobType,
  OnChainJobStatus,
} from "../generated/prisma/browser.js";
import type { Prisma } from "../generated/prisma/client.js";
import { finalizedOnChainJobStatuses } from "../types/job.js";

/**
 * Shared grace window (ms) after the effective payment deadline. Used by all
 * job sync selectors and by core job-sync runtime checks so DB selection and
 * in-memory gating stay aligned.
 */
export const JOB_SYNC_PAYMENT_GRACE_MS = 1000 * 60 * 10;

export function buildJobsNeedingPurchaseSyncWhere(
  cutoffTime: Date = new Date(Date.now() - JOB_SYNC_PAYMENT_GRACE_MS),
): Prisma.JobWhereInput {
  return {
    jobType: JobType.PAID,
    OR: [
      {
        purchase: {
          onChainStatus: {
            notIn: finalizedOnChainJobStatuses,
          },
        },
      },
      {
        purchase: {
          onChainStatus: null,
        },
      },
      {
        purchase: null,
        OR: [
          { payByTime: { not: null, gt: cutoffTime } },
          { payByTime: null, createdAt: { gt: cutoffTime } },
        ],
      },
    ],
    NOT: [
      {
        purchase: {
          onChainStatus: {
            // In-flight states that must keep polling past the dispute
            // deadline until their terminal state (funds/refund withdrawn)
            // is observed — otherwise local credit refunds never trigger.
            notIn: [
              OnChainJobStatus.DISPUTED,
              OnChainJobStatus.REFUND_REQUESTED,
              OnChainJobStatus.REFUND_AUTHORIZED,
              OnChainJobStatus.WITHDRAW_AUTHORIZED,
            ],
            not: null,
          },
        },
        externalDisputeUnlockTime: {
          not: null,
          lt: cutoffTime,
        },
      },
    ],
  };
}

export function buildJobsNeedingAgentStatusSyncWhere(): Prisma.JobWhereInput {
  return {
    // Deliberately NOT gated on the agent's current status. Hiring is gated on
    // ONLINE by the availability filter; an already-started job must keep
    // polling the revision it was pinned to (agentBlockchainIdentifier /
    // agentApiBaseUrl snapshots), because one stable Agent row now advances to
    // the newest V2 revision — a newer revision going offline would otherwise
    // strand every in-flight job started against the older one, and their
    // local credit refunds would never trigger.
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
