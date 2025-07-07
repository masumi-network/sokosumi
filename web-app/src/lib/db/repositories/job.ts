import "server-only";

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
  jobLimitedInclude,
  jobOrderBy,
  JobWithLimitedInformation,
  JobWithRelations,
  JobWithStatus,
} from "@/lib/db/types";
import { JobInputSchemaType } from "@/lib/job-input";
import {
  AgentJobStatus,
  Job,
  NextJobAction,
  OnChainJobStatus,
  Prisma,
} from "@/prisma/generated/client";

import { retrieveCreditTransactionByJobId } from "./credit";
import prisma from "./prisma";

function mapJobWithStatus(job: JobWithRelations): JobWithStatus {
  return {
    ...job,
    status: computeJobStatus(job),
  };
}

/**
 * Retrieves all jobs associated with a specific user
 * @param userId - The unique identifier of the user
 * @returns Promise containing an array of jobs with their relations
 */
export async function retrieveJobsByUserId(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobWithStatus[]> {
  const jobs = await tx.job.findMany({
    where: { userId },
    include: jobInclude,
    orderBy: jobOrderBy,
  });
  return jobs.map(mapJobWithStatus);
}

/**
 * Retrieves all jobs associated with a specific agent
 * @param agentId - The unique identifier of the agent
 * @returns Promise containing an array of jobs with their relations
 */
export async function retrieveJobsWithLimitedInformationByAgentId(
  agentId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobWithLimitedInformation[]> {
  const jobs = await tx.job.findMany({
    where: { agentId },
    select: jobLimitedInclude,
    orderBy: jobOrderBy,
  });

  return jobs;
}

/**
 * Retrieves all jobs associated with a specific agent and user
 * @param agentId - The unique identifier of the agent
 * @param userId - The unique identifier of the user
 * @returns Promise containing an array of jobs with their relations
 */
export async function retrieveJobsByAgentIdAndUserId(
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
}

/**
 * Retrieves jobs associated with a specific agent, user, and organization
 * @param agentId - The unique identifier of the agent
 * @param userId - The unique identifier of the user
 * @param organizationId - The unique identifier of the organization
 * @returns Promise containing an array of jobs with their relations
 */
export async function retrieveJobsByAgentIdUserIdAndOrganizationId(
  agentId: string,
  userId: string,
  organizationId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobWithStatus[]> {
  const jobs = await tx.job.findMany({
    where: {
      agentId,
      userId,
      organizationId,
    },
    include: jobInclude,
    orderBy: jobOrderBy,
  });

  return jobs.map(mapJobWithStatus);
}

/**
 * Retrieves personal jobs (without organization context) for a specific agent and user
 * @param agentId - The unique identifier of the agent
 * @param userId - The unique identifier of the user
 * @returns Promise containing an array of jobs with their relations
 */
export async function retrievePersonalJobsByAgentIdAndUserId(
  agentId: string,
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobWithStatus[]> {
  const jobs = await tx.job.findMany({
    where: {
      agentId,
      userId,
      organizationId: null,
    },
    include: jobInclude,
    orderBy: jobOrderBy,
  });

  return jobs.map(mapJobWithStatus);
}

export async function retrieveJobById(
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const job = await tx.job.findUnique({
    where: { id: jobId },
    include: jobInclude,
  });
  if (!job) {
    return null;
  }
  return mapJobWithStatus(job);
}

export async function retrieveJobByBlockchainIdentifier(
  blockchainIdentifier: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const job = await tx.job.findUnique({
    where: { blockchainIdentifier },
    include: jobInclude,
  });
  return job;
}

interface CreateJobData {
  agentJobId: string;
  agentId: string;
  userId: string;
  organizationId: string | null | undefined;
  inputSchema: JobInputSchemaType[];
  input: string;
  paymentId: string;
  creditsPrice: CreditsPrice;
  identifierFromPurchaser: string;
  payByTime: Date;
  externalDisputeUnlockTime: Date;
  submitResultTime: Date;
  unlockTime: Date;
  blockchainIdentifier: string;
  sellerVkey: string;
}

export async function createJob(
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
      paymentId: data.paymentId,
      inputSchema: data.inputSchema,
      input: data.input,
      identifierFromPurchaser: data.identifierFromPurchaser,
      payByTime: data.payByTime,
      externalDisputeUnlockTime: data.externalDisputeUnlockTime,
      submitResultTime: data.submitResultTime,
      unlockTime: data.unlockTime,
      blockchainIdentifier: data.blockchainIdentifier,
      sellerVkey: data.sellerVkey,
    },
  });
}

export async function refundJob(
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  const job = await tx.job.findUnique({
    where: { id: jobId },
    select: { refundedCreditTransaction: true },
  });
  if (job?.refundedCreditTransaction) {
    return;
  }

  const creditTransaction = await retrieveCreditTransactionByJobId(jobId, tx);
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
}

export async function updateJobWithAgentJobStatus(
  job: Job,
  jobStatusResponse: JobStatusResponse,
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
}

export async function updateJobWithPurchase(
  jobId: string,
  purchase: Purchase,
  tx: Prisma.TransactionClient = prisma,
) {
  const onChainStatus = onChainStateToOnChainJobStatus(purchase.onChainState);
  let data: Prisma.JobUpdateInput = {
    onChainStatus,
    inputHash: purchase.inputHash,
    outputHash: purchase.resultHash,
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
}

export async function updateJobNextActionByBlockchainIdentifier(
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
}

export async function retrieveNotFinalizedLatestJobByAgentIdAndUserId(
  agentId: string,
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobWithStatus | null> {
  const job = await tx.job.findFirst({
    where: {
      agentId,
      userId,
      OR: [
        {
          onChainStatus: {
            notIn: finalizedOnChainJobStatuses,
          },
        },
        {
          onChainStatus: null,
        },
      ],
    },
    orderBy: { startedAt: "desc" },
    include: jobInclude,
  });
  return job ? mapJobWithStatus(job) : null;
}

/**
 * Retrieves the latest non-finalized job for a specific agent, user, and organization
 * @param agentId - The unique identifier of the agent
 * @param userId - The unique identifier of the user
 * @param organizationId - The unique identifier of the organization (null for personal jobs)
 * @returns Promise containing the latest non-finalized job or null
 */
export async function retrieveNotFinalizedLatestJobByAgentIdUserIdAndOrganization(
  agentId: string,
  userId: string,
  organizationId: string | null | undefined,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobWithStatus | null> {
  // Normalize undefined to null for organizationId to ensure correct filtering (Prisma ignores undefined)
  const normalizedOrganizationId = organizationId ?? null;
  const job = await tx.job.findFirst({
    where: {
      agentId,
      userId,
      organizationId: normalizedOrganizationId,
      OR: [
        {
          onChainStatus: {
            notIn: finalizedOnChainJobStatuses,
          },
        },
        {
          onChainStatus: null,
        },
      ],
    },
    orderBy: { startedAt: "desc" },
    include: jobInclude,
  });
  return job ? mapJobWithStatus(job) : null;
}

export async function updateJobNameById(
  jobId: string,
  name: string | null,
  tx: Prisma.TransactionClient = prisma,
) {
  return await tx.job.update({
    where: { id: jobId },
    data: { name },
  });
}
