import { JobType, OnChainJobStatus, type Prisma } from "@sokosumi/database";
import {
  ACTIVE_PURCHASE_NEXT_ACTIONS,
  mapJobWithStatus,
} from "@sokosumi/database/helpers";
import {
  jobInclude,
  type JobWithSokosumiStatus,
} from "@sokosumi/database/types/job";

const REFUND_RECONCILIATION_CUTOFF_MS = 1000 * 60 * 10;

/**
 * Where clause for paid jobs that need a local refund credit but have none yet.
 * Used only by the core job sync service.
 */
export function buildJobsPendingRefundReconciliationWhere(
  cutoffTime: Date = new Date(Date.now() - REFUND_RECONCILIATION_CUTOFF_MS),
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
        payByTime: {
          not: null,
          lt: cutoffTime,
        },
      },
      {
        purchase: {
          onChainStatus: null,
          nextAction: {
            notIn: ACTIVE_PURCHASE_NEXT_ACTIONS,
          },
        },
        payByTime: {
          not: null,
          lt: cutoffTime,
        },
      },
    ],
  };
}

export async function fetchJobsPendingRefundReconciliation(
  db: Prisma.TransactionClient,
): Promise<JobWithSokosumiStatus[]> {
  const jobs = await db.job.findMany({
    where: buildJobsPendingRefundReconciliationWhere(),
    include: jobInclude,
  });
  return jobs.map(mapJobWithStatus);
}
