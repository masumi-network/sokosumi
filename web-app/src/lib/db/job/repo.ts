"use server";

import { CreditsPrice, getCreditTransactionByJobId, prisma } from "@/lib/db";
import { JobInputSchemaType } from "@/lib/job-input";
import {
  AgentJobStatus,
  Job,
  NextJobAction,
  OnChainJobStatus,
  Prisma,
} from "@/prisma/generated/client";

import {
  finalizedOnChainJobStatuses,
  jobInclude,
  jobOrderBy,
  JobStatus,
  JobWithRelations,
} from "./types";
import {
  computeJobStatus,
  jobStatusToAgentJobStatus,
  nextActionToNextJobAction,
  onChainStateToOnChainJobStatus,
  transactionStatusToOnChainTransactionStatus,
} from "./utils";

export type JobWithStatus = JobWithRelations & { status: JobStatus };

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
export async function getJobsByUserId(
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
export async function getJobsByAgentId(
  agentId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobWithStatus[]> {
  const jobs = await tx.job.findMany({
    where: { agentId },
    include: jobInclude,
    orderBy: jobOrderBy,
  });

  if (!jobs) {
    return [];
  }

  return jobs.map(mapJobWithStatus);
}

/**
 * Retrieves all jobs associated with a specific agent and user
 * @param agentId - The unique identifier of the agent
 * @param userId - The unique identifier of the user
 * @returns Promise containing an array of jobs with their relations
 */
export async function getJobsByAgentIdAndUserId(
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

export async function getJobById(
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

interface CreateJobData {
  agentJobId: string;
  agentId: string;
  userId: string;
  inputSchema: JobInputSchemaType[];
  input: string;
  paymentId: string;
  creditsPrice: CreditsPrice;
  identifierFromPurchaser: string;
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
  return await tx.job.create({
    data: {
      agentJobId: data.agentJobId,
      agent: {
        connect: {
          id: data.agentId,
        },
      },
      creditTransaction: {
        create: {
          amount: -data.creditsPrice.cents,
          includedFee: data.creditsPrice.includedFee,
          user: {
            connect: {
              id: data.userId,
            },
          },
        },
      },
      paymentId: data.paymentId,
      inputSchema: data.inputSchema,
      input: data.input,
      identifierFromPurchaser: data.identifierFromPurchaser,
      externalDisputeUnlockTime: data.externalDisputeUnlockTime,
      submitResultTime: data.submitResultTime,
      unlockTime: data.unlockTime,
      blockchainIdentifier: data.blockchainIdentifier,
      sellerVkey: data.sellerVkey,
      user: {
        connect: {
          id: data.userId,
        },
      },
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

  const creditTransaction = await getCreditTransactionByJobId(jobId, tx);
  if (!creditTransaction) {
    throw new Error("Credit transaction not found");
  }

  await tx.job.update({
    where: { id: jobId },
    data: {
      refundedCreditTransaction: {
        create: {
          amount: creditTransaction.amount * BigInt(-1),
          includedFee: creditTransaction.includedFee,
          user: {
            connect: {
              id: creditTransaction.userId,
            },
          },
        },
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

export async function setNextActionToJob(
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

export async function getNotFinalizedLatestJobByAgentIdAndUserId(
  agentId: string,
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<Job | null> {
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
  });
  return job;
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
