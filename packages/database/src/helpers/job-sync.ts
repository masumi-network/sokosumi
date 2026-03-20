import { JobType, OnChainJobStatus } from "../generated/prisma/browser.js";
import type { Prisma } from "../generated/prisma/client.js";
import {
  finalizedAgentJobStatuses,
  finalizedOnChainJobStatuses,
} from "../types/job.js";
import { ACTIVE_PURCHASE_NEXT_ACTIONS } from "./job.js";

/**
 * Shared grace window (ms) after the effective payment deadline. Used by
 * `buildJobsNeedingRemoteSyncWhere` / `buildJobsPendingLocalRefundWhere` cutoff
 * times and by core job-sync runtime checks — keep a single definition so DB
 * selection and `hasPaymentWindowExpired` stay aligned.
 */
export const JOB_SYNC_PAYMENT_GRACE_MS = 1000 * 60 * 10;

/**
 * Matches jobs whose effective payment deadline (`payByTime ?? createdAt`) is
 * before `cutoffTime`, consistent with `hasPaymentWindowExpired` in `./job`.
 */
function paymentDeadlineBeforeCutoff(cutoffTime: Date): Prisma.JobWhereInput {
  return {
    OR: [
      { payByTime: { not: null, lt: cutoffTime } },
      { payByTime: null, createdAt: { lt: cutoffTime } },
    ],
  };
}

export function buildJobsNeedingRemoteSyncWhere(
  cutoffTime: Date = new Date(Date.now() - JOB_SYNC_PAYMENT_GRACE_MS),
): Prisma.JobWhereInput {
  return {
    OR: [
      {
        purchase: {
          onChainStatus: {
            notIn: finalizedOnChainJobStatuses,
          },
        },
        jobType: JobType.PAID,
      },
      {
        purchase: {
          onChainStatus: null,
        },
        jobType: JobType.PAID,
      },
      {
        purchase: null,
        jobType: JobType.PAID,
      },
      {
        jobType: JobType.FREE,
        events: {
          none: {
            status: {
              in: finalizedAgentJobStatuses,
            },
          },
        },
      },
    ],
    NOT: [
      {
        refundedTransactionId: {
          not: null,
        },
        jobType: JobType.PAID,
      },
      {
        purchase: {
          onChainStatus: OnChainJobStatus.FUNDS_OR_DATUM_INVALID,
        },
        jobType: JobType.PAID,
      },
      {
        purchase: {
          onChainStatus: null,
          nextActionErrorType: {
            not: null,
          },
        },
        jobType: JobType.PAID,
      },
      {
        purchase: {
          onChainStatus: {
            notIn: [
              OnChainJobStatus.DISPUTED,
              OnChainJobStatus.REFUND_REQUESTED,
            ],
          },
        },
        externalDisputeUnlockTime: {
          not: null,
          lt: cutoffTime,
        },
        jobType: JobType.PAID,
      },
      {
        purchase: {
          onChainStatus: null,
          nextAction: {
            notIn: ACTIVE_PURCHASE_NEXT_ACTIONS,
          },
        },
        jobType: JobType.PAID,
        ...paymentDeadlineBeforeCutoff(cutoffTime),
      },
      {
        purchase: null,
        jobType: JobType.PAID,
        ...paymentDeadlineBeforeCutoff(cutoffTime),
      },
      {
        jobType: JobType.DEMO,
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
          onChainStatus: OnChainJobStatus.REFUND_WITHDRAWN,
        },
      },
      {
        purchase: {
          onChainStatus: OnChainJobStatus.FUNDS_OR_DATUM_INVALID,
        },
      },
      {
        purchase: {
          onChainStatus: null,
          nextActionErrorType: {
            not: null,
          },
        },
      },
      {
        purchase: null,
        ...paymentDeadlineBeforeCutoff(cutoffTime),
      },
      {
        purchase: {
          onChainStatus: null,
          nextAction: {
            notIn: ACTIVE_PURCHASE_NEXT_ACTIONS,
          },
        },
        ...paymentDeadlineBeforeCutoff(cutoffTime),
      },
    ],
  };
}
