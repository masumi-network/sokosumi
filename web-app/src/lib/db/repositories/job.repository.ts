import "server-only";

// Purchase type is declared globally in types/hey-api.d.ts
import {
  computeJobStatus,
  jobStatusToAgentJobStatus,
  nextActionToNextJobAction,
  onChainStateToOnChainJobStatus,
  transactionStatusToOnChainTransactionStatus,
} from "@/lib/db/helpers";
import {
  CreditsPrice,
  finalizedOnChainJobStatuses,
  jobInclude,
  jobOrderBy,
  JobStatus,
  JobWithStatus,
} from "@/lib/db/types";
import { JobInputSchemaType } from "@/lib/job-input";
import { JobStatusResponseSchemaType } from "@/lib/schemas";
import { generateRandomHexString } from "@/lib/utils";
import {
  AgentJobStatus,
  Job,
  NextJobAction,
  OnChainJobStatus,
  Prisma,
} from "@/prisma/generated/client";

import { creditTransactionRepository } from "./creditTransaction.repository";
import prisma from "./prisma";

function mapJobWithStatus<T extends Job>(
  job: T,
): T & { status: JobStatus; jobStatusSettled: boolean } {
  return {
    ...job,
    status: computeJobStatus(job),
    jobStatusSettled: new Date() > job.externalDisputeUnlockTime,
  };
}

interface CreateDemoJobData {
  agentJobId: string;
  agentId: string;
  userId: string;
  organizationId: string | null | undefined;
  inputSchema: JobInputSchemaType[];
  input: string;
  name: string | null;
  agentJobStatus: AgentJobStatus;
  output: string;
  completedAt: Date | null;
  // Hashing and identifier (for demo parity with on-chain jobs)
  identifierFromPurchaser: string;
  inputHash: string | null;
  resultHash: string | null;
}

interface CreateJobData {
  agentJobId: string;
  agentId: string;
  userId: string;
  organizationId: string | null | undefined;
  inputSchema: JobInputSchemaType[];
  input: string;
  purchaseId?: string;
  creditsPrice: CreditsPrice;
  identifierFromPurchaser: string;
  payByTime: Date;
  externalDisputeUnlockTime: Date;
  submitResultTime: Date;
  unlockTime: Date;
  blockchainIdentifier: string;
  sellerVkey: string;
  name: string | null;
  // for demo jobs
  agentJobStatus?: AgentJobStatus | null;
  output?: string | null;
  completedAt?: Date | null;
  isDemo?: boolean;
}

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
    AND "isDemo" = false
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
    const result = await tx.job.count({
      where: {
        agentId,
        isDemo: false,
      },
    });
    return result;
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
  ) {
    const job = await tx.job.findUnique({
      where: { blockchainIdentifier },
      include: jobInclude,
    });
    return job;
  },

  async createDemoJob(
    data: CreateDemoJobData,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Job> {
    // Build the credit transaction data based on whether it's for a user or organization
    const creditTransactionData: Prisma.CreditTransactionCreateInput = {
      amount: BigInt(0),
      includedFee: BigInt(0),
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
    };

    return await tx.job.create({
      data: {
        agentJobId: data.agentJobId,
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
        creditTransaction: {
          create: creditTransactionData,
        },
        inputSchema: data.inputSchema,
        input: data.input,
        identifierFromPurchaser: data.identifierFromPurchaser,
        payByTime: new Date(Date.now() + 60 * 60 * 1000),
        submitResultTime: new Date(Date.now() + 2 * 60 * 60 * 1000),
        unlockTime: new Date(Date.now() + 3 * 60 * 60 * 1000),
        externalDisputeUnlockTime: new Date(Date.now() + 4 * 60 * 60 * 1000),
        blockchainIdentifier: generateRandomHexString(128),
        sellerVkey: generateRandomHexString(),
        name: data.name,
        agentJobStatus: data.agentJobStatus,
        output: data.output,
        // Persist demo hashes for verification badge parity
        ...(data.inputHash && { inputHash: data.inputHash }),
        ...(data.resultHash && { resultHash: data.resultHash }),
        completedAt: data.completedAt,
        isDemo: true,
      },
    });
  },

  async createJob(
    data: CreateJobData,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<Job> {
    // Build the credit transaction data based on whether it's for a user or organization
    const creditTransactionData: Prisma.CreditTransactionCreateInput = {
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
    };

    return await tx.job.create({
      data: {
        agentJobId: data.agentJobId,
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
        creditTransaction: {
          create: creditTransactionData,
        },
        ...(data.purchaseId && {
          purchaseId: data.purchaseId,
        }),
        inputSchema: data.inputSchema,
        input: data.input,
        identifierFromPurchaser: data.identifierFromPurchaser,
        payByTime: data.payByTime,
        externalDisputeUnlockTime: data.externalDisputeUnlockTime,
        submitResultTime: data.submitResultTime,
        unlockTime: data.unlockTime,
        blockchainIdentifier: data.blockchainIdentifier,
        sellerVkey: data.sellerVkey,
        name: data.name,
        // for demo job
        agentJobStatus: data.agentJobStatus,
        output: data.output,
        completedAt: data.completedAt,
        isDemo: data.isDemo,
      },
    });
  },

  async refundJob(jobId: string, tx: Prisma.TransactionClient = prisma) {
    const job = await tx.job.findUnique({
      where: { id: jobId },
      select: { refundedCreditTransaction: true },
    });

    // If the job has already been refunded, do nothing
    if (job?.refundedCreditTransaction) {
      return;
    }

    const creditTransaction =
      await creditTransactionRepository.getCreditTransactionByJobId(jobId, tx);
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
    job: Job,
    jobStatusResponse: JobStatusResponseSchemaType,
    tx: Prisma.TransactionClient = prisma,
  ) {
    const output = JSON.stringify(jobStatusResponse);
    const agentJobStatus = jobStatusToAgentJobStatus(jobStatusResponse.status);
    const data: Prisma.JobUpdateInput = {
      agentJobStatus,
      output,
      ...(agentJobStatus === AgentJobStatus.COMPLETED &&
        job.completedAt === null && {
          completedAt: new Date(),
        }),
    };

    const updatedJob = await tx.job.update({
      where: { id: job.id },
      data,
      include: jobInclude,
    });
    return mapJobWithStatus(updatedJob);
  },

  async updateJobWithPurchase(
    jobId: string,
    purchase: Purchase,
    tx: Prisma.TransactionClient = prisma,
  ) {
    const onChainStatus = onChainStateToOnChainJobStatus(purchase.onChainState);
    let data: Prisma.JobUpdateInput = {
      purchaseId: purchase.id,
      onChainStatus,
      inputHash: purchase.inputHash,
      resultHash: purchase.resultHash,
    };
    if (onChainStatus === OnChainJobStatus.RESULT_SUBMITTED) {
      data.resultSubmittedAt = new Date();
    }

    const nextAction = nextActionToNextJobAction(purchase.NextAction);
    data = {
      ...data,
      nextAction: nextAction.requestedAction,
      nextActionErrorType: nextAction.errorType,
      nextActionErrorNote: nextAction.errorNote,
    };

    const transaction = purchase.CurrentTransaction;
    if (transaction) {
      data = {
        ...data,
        onChainTransactionHash: transaction.txHash,
        onChainTransactionStatus: transactionStatusToOnChainTransactionStatus(
          transaction.status,
        ),
      };
    }

    const job = await tx.job.update({
      where: { id: jobId },
      data,
      include: jobInclude,
    });
    return mapJobWithStatus(job);
  },

  async updateJobNextActionByBlockchainIdentifier(
    jobBlockchainIdentifier: string,
    nextJobAction: NextJobAction,
    tx: Prisma.TransactionClient = prisma,
  ) {
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
    const job = await tx.job.findFirst({
      where: {
        agentId,
        userId,
        organizationId: normalizedOrganizationId,
        ...jobsNotFinishedWhereQuery(),
      },
      orderBy: { startedAt: "desc" },
      include: jobInclude,
    });
    return job;
  },

  async updateJobNameById(
    jobId: string,
    name: string | null,
    tx: Prisma.TransactionClient = prisma,
  ) {
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
  ) {
    const job = await tx.job.findUnique({
      where: {
        id: jobId,
        userId,
        organizationId,
      },
      include: jobInclude,
    });

    if (!job) {
      return null;
    }

    return mapJobWithStatus(job);
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
    organizationId: string,
    agentId?: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobWithStatus[]> {
    const jobs = await tx.job.findMany({
      where: {
        ...(agentId && { agentId }),
        shares: {
          some: {
            recipientOrganizationId: organizationId,
          },
        },
      },
      include: {
        ...jobInclude,
        shares: {
          include: {
            creator: {
              select: {
                id: true,
                name: true,
                image: true,
              },
            },
          },
        },
      },
      orderBy: jobOrderBy,
    });
    return jobs.map(mapJobWithStatus);
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
const jobsNotFinishedWhereQuery = (
  cutoffTime: Date = new Date(Date.now() - 1000 * 60 * 10),
): Prisma.JobWhereInput => ({
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
        lt: cutoffTime,
      },
    },
    // Filter out jobs that have no on-chain status and have a payByTime that is less than the cutoff time
    {
      onChainStatus: null,
      payByTime: {
        lt: cutoffTime,
      },
    },
    // Filter out demo jobs
    {
      isDemo: true,
    },
  ],
});
