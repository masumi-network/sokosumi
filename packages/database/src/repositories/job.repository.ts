import { JobType, OnChainJobStatus } from "../generated/prisma/browser.js";
import type { Prisma } from "../generated/prisma/client.js";
import { mapJobWithStatus } from "../helpers/job.js";
import {
  finalizedAgentJobStatuses,
  type JobWithSokosumiStatus,
  jobInclude,
} from "../types/job.js";

export const jobRepository = {
  async getJobById(
    jobId: string,
    tx: Prisma.TransactionClient,
  ): Promise<JobWithSokosumiStatus | null> {
    const job = await tx.job.findUnique({
      where: { id: jobId },
      include: jobInclude,
    });
    if (!job) {
      return null;
    }
    return mapJobWithStatus(job);
  },

  async doesUserHaveFinishedJobWithAgent(
    ownerId: string,
    agentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const jobCount = await tx.job.count({
      where: {
        ownerId,
        agentId,
        ...jobsFinishedWhereQuery(),
      },
    });

    return jobCount > 0;
  },
};

/**
 * Finished: agent status Completed/Failed, and on-chain status is not
 * FUNDS_LOCKED, REFUND_REQUESTED, or REFUND_AUTHORIZED (authorized refund
 * still needs its on-chain withdrawal), or is null for FREE jobs.
 */
function jobsFinishedWhereQuery(): Prisma.JobWhereInput {
  return {
    AND: [
      {
        events: {
          some: {
            status: {
              in: finalizedAgentJobStatuses,
            },
          },
        },
        OR: [
          { purchase: { onChainStatus: null }, jobType: JobType.FREE },
          {
            purchase: {
              onChainStatus: {
                notIn: [
                  OnChainJobStatus.FUNDS_LOCKED,
                  OnChainJobStatus.REFUND_REQUESTED,
                  OnChainJobStatus.REFUND_AUTHORIZED,
                ],
              },
            },
          },
        ],
      },
    ],
  };
}
