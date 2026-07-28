import {
  AgentJobStatus,
  AgentStatus,
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

/**
 * A paid job whose on-chain window is still open must keep polling even when
 * its agent is no longer ONLINE: one stable Agent row now advances to the
 * newest V2 revision, so a newer revision reporting Offline would otherwise
 * strand every in-flight job pinned to an older one (they carry their own
 * agentBlockchainIdentifier / agentApiBaseUrl snapshots).
 *
 * Scoped deliberately: the bypass ends with the dispute window, so jobs
 * against permanently dead agents leave the poll set instead of accumulating
 * forever and starving later sync phases.
 */
function buildInFlightAgentSnapshotWhere(now: Date): Prisma.JobWhereInput {
  return {
    jobType: JobType.PAID,
    externalDisputeUnlockTime: { gt: now },
  };
}

export function buildJobsNeedingAgentStatusSyncWhere(
  now: Date = new Date(),
): Prisma.JobWhereInput {
  return {
    // Hiring is gated on ONLINE by the availability filter. Here the gate only
    // controls MIP-003 status polling, so it stays in place for dead agents
    // and is bypassed only for paid jobs still inside their on-chain window.
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
