import "server-only";

import prisma from "../client";
import {
  AgentJobStatus,
  JobType,
  OnChainJobStatus,
} from "../generated/prisma/browser";
import type {
  Job,
  NextJobAction,
  NextJobActionErrorType,
  OnChainTransactionStatus,
  Prisma,
} from "../generated/prisma/client";
import { mapJobWithStatus } from "../helpers/job";
import {
  finalizedAgentJobStatuses,
  finalizedOnChainJobStatuses,
  jobInclude,
  jobOrderBy,
  type JobWithRelations,
  type JobWithStatus,
} from "../types/job";

interface CreateDemoJobData {
  jobType: typeof JobType.DEMO;
  agentJobId: string;
  agentId: string;
  userId: string;
  organizationId: string | null | undefined;
  inputSchema: unknown[];
  input: string;
  name: string | null;
  agentJobStatus: AgentJobStatus;
  output: string;
  completedAt: Date | null;
}

interface CreateJobBase {
  agentJobId: string;
  agentId: string;
  userId: string;
  organizationId: string | null | undefined;
  inputSchema: unknown[];
  input: string;
  name: string | null;
  jobScheduleId?: string | null | undefined;
  agentJobStatus?: AgentJobStatus | null;
  output?: string | null;
  completedAt?: Date | null;
}

interface CreatePaidJobData extends CreateJobBase {
  jobType: typeof JobType.PAID;
  identifierFromPurchaser: string;
  creditsPrice: {
    cents: bigint;
    includedFee: bigint;
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
  async getJobsNotFinished(
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobWithStatus[]> {
    const jobs = await tx.job.findMany({
      where: jobsNotFinishedWhereQuery(),
      include: jobInclude,
    });
    return jobs.map(mapJobWithStatus);
  },

  /**
   * Retrieves all jobs associated with a specific user
   * @param userId - The unique identifier of the user
   * @returns Promise containing an array of jobs with their relations
   */
  async getJobsByUserId(
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobWithStatus[]> {
    const jobs = await tx.job.findMany({
      where: { userId },
      include: jobInclude,
      orderBy: jobOrderBy,
    });
    return jobs.map(mapJobWithStatus);
  },

  /**
   * Retrieves the average execution duration in milliseconds for a specific agent
   * @param agentId - The unique identifier of the agent
   * @returns Promise containing the average execution duration in seconds
   */
  async getAverageExecutionDurationByAgentId(
    agentId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<number> {
    const result = await tx.$queryRaw<[{ avg_duration_seconds: number }]>`
    SELECT 
      AVG(EXTRACT(EPOCH FROM ("completedAt" - "startedAt"))) as avg_duration_seconds
    FROM "Job"
    WHERE "agentId" = ${agentId}
    AND "jobType" != 'DEMO'
    AND "completedAt" IS NOT NULL
    AND "createdAt" >= NOW() - INTERVAL '30 days'
  `;

    const averageDurationSeconds = result[0]?.avg_duration_seconds ?? 0;
    return averageDurationSeconds * 1000;
  },

  /**
   * Retrieves the number of executed jobs for a specific agent (not demo jobs)
   * @param agentId - The unique identifier of the agent
   * @returns Promise containing the number of executed jobs
   */
  async getExecutedJobsCountByAgentId(
    agentId: string,
    tx: Prisma.TransactionClient = prisma,
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
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobWithStatus[]> {
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
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobWithStatus | null> {
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
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobWithRelations | null> {
    return await tx.job.findUnique({
      where: { blockchainIdentifier },
      include: jobInclude,
    });
  },

  async createDemoJob(
    data: CreateDemoJobData,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Job> {
    return await tx.job.create({
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
        inputSchema: JSON.stringify(data.inputSchema),
        input: data.input,
        payByTime: null,
        submitResultTime: null,
        unlockTime: null,
        externalDisputeUnlockTime: null,
        blockchainIdentifier: null,
        sellerVkey: null,
        name: data.name,
        agentJobStatus: data.agentJobStatus,
        output: data.output,
        completedAt: data.completedAt,
      },
    });
  },

  async createJob(
    data: CreateJobData,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Job> {
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
      inputSchema: JSON.stringify(data.inputSchema),
      input: data.input,
      name: data.name,
      ...(data.jobScheduleId && {
        jobSchedule: { connect: { id: data.jobScheduleId } },
      }),
      ...(data.agentJobStatus !== undefined && {
        agentJobStatus: data.agentJobStatus,
      }),
      ...(data.output !== undefined && { output: data.output }),
      ...(data.completedAt !== undefined && { completedAt: data.completedAt }),
    };

    switch (data.jobType) {
      case JobType.FREE:
        return tx.job.create({
          data: {
            ...baseJobData,
            purchaseId: null,
            payByTime: null,
            externalDisputeUnlockTime: null,
            submitResultTime: null,
            unlockTime: null,
            blockchainIdentifier: null,
            sellerVkey: null,
            identifierFromPurchaser: null,
          },
        });
      case JobType.PAID:
        return tx.job.create({
          data: {
            ...baseJobData,
            creditTransaction: {
              create: {
                amount: -data.creditsPrice.cents,
                includedFee: data.creditsPrice.includedFee,
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
              },
            },
            ...(data.purchaseId && { purchaseId: data.purchaseId }),
            payByTime: data.payByTime,
            externalDisputeUnlockTime: data.externalDisputeUnlockTime,
            submitResultTime: data.submitResultTime,
            unlockTime: data.unlockTime,
            blockchainIdentifier: data.blockchainIdentifier,
            sellerVkey: data.sellerVkey,
            identifierFromPurchaser: data.identifierFromPurchaser,
          },
        });
      default: {
        const _exhaustive: never = data;
        throw new Error(`Unsupported job type: ${_exhaustive}`);
      }
    }
  },

  async refundJob(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<void> {
    const job = await tx.job.findUnique({
      where: { id: jobId },
      select: {
        refundedCreditTransaction: true,
        creditTransaction: true,
      },
    });

    // If the job has already been refunded, do nothing
    if (job?.refundedCreditTransaction) {
      return;
    }

    const creditTransaction = job?.creditTransaction;

    if (!creditTransaction) {
      throw new Error("Credit transaction not found");
    }

    // Build refund transaction data based on whether it's for a user or organization
    const refundTransactionData: Prisma.CreditTransactionCreateInput = {
      amount: creditTransaction.amount * BigInt(-1),
      includedFee: creditTransaction.includedFee,
      user: {
        connect: {
          id: creditTransaction.userId,
        },
      },
      ...(creditTransaction.organizationId && {
        organization: {
          connect: {
            id: creditTransaction.organizationId,
          },
        },
      }),
    };

    await tx.job.update({
      where: { id: jobId },
      data: {
        refundedCreditTransaction: {
          create: refundTransactionData,
        },
      },
    });
  },

  async updateJobWithAgentJobStatus(
    jobId: string,
    agentJobStatus: AgentJobStatus,
    output: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobWithStatus> {
    // Fetch the current job to check if it's already completed
    const currentJob = await tx.job.findUnique({ where: { id: jobId } });

    const data: Prisma.JobUpdateInput = {
      agentJobStatus,
      output,
      ...(agentJobStatus === AgentJobStatus.COMPLETED &&
        currentJob?.completedAt === null && {
          completedAt: new Date(),
        }),
    };

    const updatedJob = await tx.job.update({
      where: { id: jobId },
      data,
      include: jobInclude,
    });
    return mapJobWithStatus(updatedJob);
  },

  async updateJobWithPurchase(
    jobId: string,
    data: {
      purchaseId: string;
      onChainStatus: OnChainJobStatus | null;
      inputHash: string | null;
      resultHash: string | null;
      nextAction: NextJobAction;
      nextActionErrorType: NextJobActionErrorType | null;
      nextActionErrorNote: string | null;
      onChainTransactionHash?: string;
      onChainTransactionStatus?: OnChainTransactionStatus;
      resultSubmittedAt?: Date;
    },
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobWithStatus> {
    const updateData: Prisma.JobUpdateInput = {
      purchaseId: data.purchaseId,
      onChainStatus: data.onChainStatus,
      inputHash: data.inputHash,
      resultHash: data.resultHash,
      nextAction: data.nextAction,
      nextActionErrorType: data.nextActionErrorType,
      nextActionErrorNote: data.nextActionErrorNote,
      ...(data.onChainTransactionHash && {
        onChainTransactionHash: data.onChainTransactionHash,
      }),
      ...(data.onChainTransactionStatus && {
        onChainTransactionStatus: data.onChainTransactionStatus,
      }),
      ...(data.resultSubmittedAt && {
        resultSubmittedAt: data.resultSubmittedAt,
      }),
    };

    const job = await tx.job.update({
      where: { id: jobId },
      data: updateData,
      include: jobInclude,
    });
    return mapJobWithStatus(job);
  },

  async updateJobNextActionByBlockchainIdentifier(
    jobBlockchainIdentifier: string,
    nextJobAction: NextJobAction,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobWithStatus> {
    const job = await tx.job.update({
      where: { blockchainIdentifier: jobBlockchainIdentifier },
      data: { nextAction: nextJobAction },
      include: jobInclude,
    });
    return mapJobWithStatus(job);
  },

  async getNotFinishedLatestJobByAgentIdAndUserId(
    agentId: string,
    userId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobWithStatus | null> {
    const job = await tx.job.findFirst({
      where: {
        agentId,
        userId,
        ...jobsNotFinishedWhereQuery(),
      },
      orderBy: { startedAt: "desc" },
      include: jobInclude,
    });
    return job ? mapJobWithStatus(job) : null;
  },

  /**
   * Retrieves the latest not-finished job a specific agent, user, and organization
   * @param agentId - The unique identifier of the agent
   * @param userId - The unique identifier of the user
   * @param organizationId - The unique identifier of the organization (null for personal jobs)
   * @returns Promise latest not-finished job or null
   */
  async getLatestJobByAgentIdUserIdAndOrganization(
    agentId: string,
    userId: string,
    organizationId: string | null | undefined,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Job | null> {
    // Normalize undefined to null for organizationId to ensure correct filtering (Prisma ignores undefined)
    const normalizedOrganizationId = organizationId ?? null;
    return await tx.job.findFirst({
      where: {
        agentId,
        userId,
        organizationId: normalizedOrganizationId,
        ...jobsNotFinishedWhereQuery(),
      },
      orderBy: { startedAt: "desc" },
      include: jobInclude,
    });
  },

  async updateJobNameById(
    jobId: string,
    name: string | null,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Job> {
    return await tx.job.update({
      where: { id: jobId },
      data: { name },
    });
  },

  /**
   * Retrieves a job by ID with authorization checks
   * Ensures the job belongs to the specified user and organization context
   * @param jobId - The unique identifier of the job
   * @param userId - The unique identifier of the user (must match job owner)
   * @param organizationId - The organization context (null for personal jobs)
   * @returns Promise containing the job if authorized, null if not found or not authorized
   */
  async getJobByIdWithAuthCheck(
    jobId: string,
    userId: string,
    organizationId: string | null,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobWithStatus | null> {
    const job = await tx.job.findUnique({
      where: {
        id: jobId,
        userId,
        organizationId,
      },
      include: jobInclude,
    });
    return job ? mapJobWithStatus(job) : null;
  },

  async getJobs(
    where: Prisma.JobWhereInput,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobWithStatus[]> {
    const jobs = await tx.job.findMany({
      where,
      include: jobInclude,
      orderBy: jobOrderBy,
    });
    return jobs.map(mapJobWithStatus);
  },

  async getJobsSharedWithOrganization(
    userId: string,
    agentId: string,
    organizationId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobWithStatus[]> {
    const jobs = await tx.job.findMany({
      where: {
        userId: { not: userId },
        agentId,
        share: {
          organizationId,
        },
      },
      include: jobInclude,
      orderBy: jobOrderBy,
    });
    return jobs.map(mapJobWithStatus);
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
    tx: Prisma.TransactionClient = prisma,
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
 * Creates a Prisma where query to filter for jobs that are not finished.
 *
 * A job is considered "not finished" if it meets any of the following criteria:
 * - Has an on-chain status that is not finalized (not in finalizedOnChainJobStatuses)
 * - Has no on-chain status but has a payByTime that is greater than the cutoff time
 *
 * Jobs are excluded if they meet any of the following criteria:
 * - Have been refunded (refundedCreditTransactionId is not null)
 * - Are non-disputed and have passed their external dispute grace period
 * - Have no on-chain status and no payByTime set
 *
 * @param cutoffTime - The time threshold for filtering jobs (defaults to 10 minutes ago)
 * @returns Prisma where query object for filtering non-finished jobs
 */
function jobsNotFinishedWhereQuery(
  cutoffTime: Date = new Date(Date.now() - 1000 * 60 * 10),
): Prisma.JobWhereInput {
  return {
    OR: [
      // Filter out jobs that are finalized
      {
        onChainStatus: {
          notIn: finalizedOnChainJobStatuses,
        },
      },
      // Filter in jobs that have no on-chain status
      {
        onChainStatus: null,
      },
    ],
    NOT: [
      // Filter out jobs that are refunded
      {
        refundedCreditTransactionId: {
          not: null,
        },
      },
      // Filter out jobs that are non-disputed and have a externalDisputeUnlockTime that is less than the cutoff time
      {
        onChainStatus: { not: OnChainJobStatus.DISPUTED },
        externalDisputeUnlockTime: {
          not: null,
          lt: cutoffTime,
        },
      },
      // Filter out jobs that have no on-chain status and have a payByTime that is less than the cutoff time
      {
        onChainStatus: null,
        payByTime: { not: null, lt: cutoffTime },
      },
      // Filter out demo jobs
      {
        jobType: JobType.DEMO,
      },
      // Filter out free jobs that are completed or failed on agentJobStatus
      {
        jobType: JobType.FREE,
        agentJobStatus: {
          not: null,
          in: finalizedAgentJobStatuses,
        },
      },
    ],
  };
}

/**
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
        agentJobStatus: {
          in: finalizedAgentJobStatuses,
        },
        // Check for finalized on-chain statuses
        OR: [
          { onChainStatus: null, jobType: JobType.FREE },
          {
            onChainStatus: {
              notIn: [
                OnChainJobStatus.FUNDS_LOCKED,
                OnChainJobStatus.REFUND_REQUESTED,
              ],
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
