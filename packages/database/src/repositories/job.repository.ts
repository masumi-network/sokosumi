import type { InputSchemaSchemaType } from "@sokosumi/masumi/schemas";

import {
  AgentJobStatus,
  JobType,
  OnChainJobStatus,
} from "../generated/prisma/browser.js";
import type { Prisma } from "../generated/prisma/client.js";
import { mapJobWithStatus } from "../helpers/job.js";
import {
  finalizedAgentJobStatuses,
  type JobWithSokosumiStatus,
  jobInclude,
  jobOrderBy,
} from "../types/job.js";
import { creditBucketRepository } from "./credit-bucket.repository.js";

interface CreateDemoJobData {
  jobType: typeof JobType.DEMO;
  agentJobId: string;
  agentId: string;
  userId: string;
  organizationId?: string | null;
  workspaceId: string;
  inputSchema: InputSchemaSchemaType;
  input: string;
  name: string | null;
  result?: string | null;
}

interface CreateJobBase {
  agentJobId: string;
  agentId: string;
  userId: string;
  organizationId: string | null | undefined;
  workspaceId: string;
  inputSchema: InputSchemaSchemaType;
  input: string;
  inputHash: string | null;
  name: string | null;
}

interface CreatePaidJobData extends CreateJobBase {
  jobType: typeof JobType.PAID;
  identifierFromPurchaser: string;
  creditsPrice: {
    cents: bigint;
  };
  payByTime: Date;
  externalDisputeUnlockTime: Date;
  submitResultTime: Date;
  unlockTime: Date;
  blockchainIdentifier: string;
  sellerVkey: string;
  purchaseId?: string;
}

interface CreateFreeJobData extends CreateJobBase {
  jobType: typeof JobType.FREE;
}

type CreateJobData = CreatePaidJobData | CreateFreeJobData;

/**
 * Repository for managing Job entities and related queries.
 * Provides methods for retrieving jobs with various filters,
 * creating new jobs, updating job status, and handling job lifecycle operations.
 */
export const jobRepository = {
  /**
   * Retrieves all jobs associated with a specific user
   * @param userId - The unique identifier of the user
   * @returns Promise containing an array of jobs with their relations
   */
  async getJobsByUserId(
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<JobWithSokosumiStatus[]> {
    const jobs = await tx.job.findMany({
      where: { userId },
      include: jobInclude,
      orderBy: jobOrderBy,
    });
    return jobs.map(mapJobWithStatus);
  },

  /**
   * Retrieves the average execution duration in seconds for a specific agent
   * @param agentId - The unique identifier of the agent
   * @returns Promise containing the average execution duration in seconds
   */
  async getAverageExecutionDurationByAgentId(
    agentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number | null> {
    const result = await tx.$queryRaw<
      [{ avg_duration_seconds: Prisma.Decimal | null }]
    >`
    SELECT 
      COALESCE(AVG(EXTRACT(EPOCH FROM (completed."createdAt" - initiated."createdAt"))), 0) as avg_duration_seconds
    FROM "Job" j
    INNER JOIN "jobEvent" initiated ON initiated."jobId" = j.id
      AND initiated."status" = 'INITIATED'::"AgentJobStatus"
    INNER JOIN "jobEvent" completed ON completed."jobId" = j.id
      AND completed."status" = 'COMPLETED'::"AgentJobStatus"
    WHERE j."agentId" = ${agentId}
    AND j."jobType" != 'DEMO'
    AND j."createdAt" >= NOW() - INTERVAL '90 days'
  `;
    const averageDurationSeconds = result[0]?.avg_duration_seconds;
    if (!averageDurationSeconds) {
      return null;
    }
    return averageDurationSeconds.toNumber();
  },

  /**
   * Retrieves the number of executed jobs for a specific agent (not demo jobs)
   * @param agentId - The unique identifier of the agent
   * @returns Promise containing the number of executed jobs
   */
  async getExecutedJobsCountByAgentId(
    agentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    return await tx.job.count({
      where: {
        agentId,
        jobType: {
          not: JobType.DEMO,
        },
      },
    });
  },

  /**
   * Retrieves all jobs associated with a specific agent and user (not demo jobs)
   * @param agentId - The unique identifier of the agent
   * @param userId - The unique identifier of the user
   * @returns Promise containing an array of jobs with their relations
   */
  async getJobsByAgentIdAndUserId(
    agentId: string,
    userId: string,
    tx: Prisma.TransactionClient,
  ): Promise<JobWithSokosumiStatus[]> {
    const jobs = await tx.job.findMany({
      where: { agentId, userId },
      include: jobInclude,
      orderBy: jobOrderBy,
    });

    if (!jobs) {
      return [];
    }

    return jobs.map(mapJobWithStatus);
  },

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

  async getJobByBlockchainIdentifier(
    blockchainIdentifier: string,
    tx: Prisma.TransactionClient,
  ): Promise<JobWithSokosumiStatus | null> {
    const job = await tx.job.findUnique({
      where: { blockchainIdentifier },
      include: jobInclude,
    });
    return job ? mapJobWithStatus(job) : null;
  },

  async createDemoJob(
    data: CreateDemoJobData,
    tx: Prisma.TransactionClient,
  ): Promise<JobWithSokosumiStatus> {
    const inputSchemaSnapshot = JSON.stringify(data.inputSchema);

    const job = await tx.job.create({
      data: {
        agentJobId: data.agentJobId,
        jobType: JobType.DEMO,
        agent: {
          connect: {
            id: data.agentId,
          },
        },
        user: {
          connect: {
            id: data.userId,
          },
        },
        ...(data.organizationId && {
          organization: {
            connect: {
              id: data.organizationId,
            },
          },
        }),
        workspace: {
          connect: {
            id: data.workspaceId,
          },
        },
        events: {
          create: {
            status: AgentJobStatus.INITIATED,
            result: null,
            inputSchema: inputSchemaSnapshot,
            input: {
              create: {
                input: data.input,
              },
            },
          },
        },
        payByTime: null,
        submitResultTime: null,
        unlockTime: null,
        externalDisputeUnlockTime: null,
        blockchainIdentifier: null,
        sellerVkey: null,
        name: data.name,
      },
      include: jobInclude,
    });

    const updatedJob = await tx.job.update({
      where: { id: job.id },
      data: {
        events: {
          create: {
            status: AgentJobStatus.COMPLETED,
            result: data.result,
          },
        },
      },
      include: jobInclude,
    });
    return mapJobWithStatus(updatedJob);
  },

  async createJob(
    data: CreateJobData,
    tx: Prisma.TransactionClient,
  ): Promise<JobWithSokosumiStatus> {
    const inputSchemaSnapshot = JSON.stringify(data.inputSchema);

    const baseJobData: Prisma.JobCreateInput = {
      agentJobId: data.agentJobId,
      jobType: data.jobType,
      agent: {
        connect: {
          id: data.agentId,
        },
      },
      user: {
        connect: {
          id: data.userId,
        },
      },
      ...(data.organizationId && {
        organization: {
          connect: {
            id: data.organizationId,
          },
        },
      }),
      workspace: {
        connect: {
          id: data.workspaceId,
        },
      },
      events: {
        create: {
          status: AgentJobStatus.INITIATED,
          result: null,
          inputSchema: inputSchemaSnapshot,
          input: {
            create: {
              input: data.input,
              inputHash: data.inputHash,
            },
          },
        },
      },

      name: data.name,
    };

    switch (data.jobType) {
      case JobType.FREE: {
        const freeJob = await tx.job.create({
          data: {
            ...baseJobData,
            payByTime: null,
            externalDisputeUnlockTime: null,
            submitResultTime: null,
            unlockTime: null,
            blockchainIdentifier: null,
            sellerVkey: null,
            identifierFromPurchaser: null,
          },
          include: jobInclude,
        });
        return mapJobWithStatus(freeJob);
      }
      case JobType.PAID: {
        const consumptions = await creditBucketRepository.prepareConsumption(
          data.userId,
          data.organizationId ?? null,
          data.creditsPrice.cents,
          tx,
        );

        const paidJob = await tx.job.create({
          data: {
            ...baseJobData,
            transaction: {
              create: {
                amount: -data.creditsPrice.cents,
                user: {
                  connect: {
                    id: data.userId,
                  },
                },
                ...(data.organizationId && {
                  organization: {
                    connect: {
                      id: data.organizationId,
                    },
                  },
                }),
                creditConsumptions: {
                  createMany: {
                    data: consumptions.map((consumption) => ({
                      bucketId: consumption.bucketId,
                      amount: consumption.amount,
                    })),
                  },
                },
              },
            },
            payByTime: data.payByTime,
            externalDisputeUnlockTime: data.externalDisputeUnlockTime,
            submitResultTime: data.submitResultTime,
            unlockTime: data.unlockTime,
            blockchainIdentifier: data.blockchainIdentifier,
            sellerVkey: data.sellerVkey,
            identifierFromPurchaser: data.identifierFromPurchaser,
          },
          include: jobInclude,
        });
        return mapJobWithStatus(paidJob);
      }
      default: {
        const _exhaustive: never = data;
        throw new Error(`Unsupported job type: ${_exhaustive}`);
      }
    }
  },

  async updateJobNameById(
    jobId: string,
    name: string | null,
    tx: Prisma.TransactionClient,
  ): Promise<JobWithSokosumiStatus> {
    const job = await tx.job.update({
      where: { id: jobId },
      data: { name },
      include: jobInclude,
    });
    return mapJobWithStatus(job);
  },

  /**
   * Check if user has finished job with the agent
   * @param userId - The unique identifier of the user
   * @param agentId - The unique identifier of the agent
   * @returns Promise containing true if user has finished job with the agent, false otherwise
   */
  async doesUserHaveFinishedJobWithAgent(
    userId: string,
    agentId: string,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const jobCount = await tx.job.count({
      where: {
        userId,
        agentId,
        jobType: {
          not: JobType.DEMO,
        },
        ...jobsFinishedWhereQuery(),
      },
    });

    return jobCount > 0;
  },
};

/**
 * Creates a Prisma where query to filter for jobs that still need sync work.
 *
 * Creates a Prisma where query to filter for jobs that are finished.
 * @returns Prisma where query object for filtering finished jobs
 *
 * A job is considered "finished" if it meets any of the following criteria:
 * - AgentJobStatus is either Completed or Failed
 * - OnChainStatus is not FUNDS_LOCKED or REFUND_REQUESTED
 *   or is null for FREE jobs
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
                ],
              },
            },
          },
        ],
      },
    ],
  };
}

// Export types for use in web app
export type {
  CreateDemoJobData,
  CreateFreeJobData,
  CreateJobData,
  CreatePaidJobData,
};
