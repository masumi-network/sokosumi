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

  /**
   * Check if user has finished job with the agent
   * @param ownerId - The unique identifier of the job owner
   * @param agentId - The unique identifier of the agent
   * @returns Promise containing true if user has finished job with the agent, false otherwise
   */
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
 * Creates a Prisma where query to filter for jobs that are finished.
 *
 * A job is considered "finished" if it meets any of the following criteria:
 * - AgentJobStatus is either Completed or Failed
 * - OnChainStatus is not FUNDS_LOCKED, REFUND_REQUESTED, or
 *   REFUND_AUTHORIZED (an authorized refund still needs its on-chain
 *   withdrawal), or is null for FREE jobs
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
        // Check for finalized on-chain statuses
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
