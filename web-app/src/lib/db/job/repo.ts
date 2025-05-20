"use server";

import { CreditsPrice, getCreditTransactionByJobId, prisma } from "@/lib/db";
import {
  AgentJobStatus,
  Job,
  NextJobAction,
  NextJobActionErrorType,
  OnChainJobStatus,
  OnChainTransactionStatus,
  Prisma,
} from "@/prisma/generated/client";

import { jobInclude, jobOrderBy, JobStatus, JobWithRelations } from "./types";
import { computeJobStatus } from "./utils";

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

export async function updateOnChainStatus(
  jobId: string,
  onChainStatus: OnChainJobStatus,
  tx: Prisma.TransactionClient = prisma,
) {
  const data: Prisma.JobUpdateInput = { onChainStatus };
  if (onChainStatus === OnChainJobStatus.RESULT_SUBMITTED) {
    data.resultSubmittedAt = new Date();
  }
  const job = await tx.job.update({
    where: { id: jobId },
    data,
    include: jobInclude,
  });
  return mapJobWithStatus(job);
}

export async function updateAgentJobStatus(
  jobId: string,
  agentJobStatus: AgentJobStatus,
  output: string | null,
  tx: Prisma.TransactionClient = prisma,
) {
  const data: Prisma.JobUpdateInput = { agentJobStatus, output };
  if (agentJobStatus === AgentJobStatus.COMPLETED) {
    data.completedAt = new Date();
  }
  const job = await tx.job.update({
    where: { id: jobId },
    data,
    include: jobInclude,
  });
  return mapJobWithStatus(job);
}

export async function updateNextAction(
  jobId: string,
  nextAction: NextJobAction,
  nextActionErrorType: NextJobActionErrorType | null,
  nextActionErrorNote: string | null,
  tx: Prisma.TransactionClient = prisma,
) {
  const job = await tx.job.update({
    where: { id: jobId },
    data: { nextAction, nextActionErrorType, nextActionErrorNote },
    include: jobInclude,
  });
  return mapJobWithStatus(job);
}

export async function connectTransaction(
  jobId: string,
  hash: string,
  status: OnChainTransactionStatus,
  tx: Prisma.TransactionClient = prisma,
) {
  const job = await tx.job.update({
    where: { id: jobId },
    data: {
      onChainTransaction: {
        upsert: {
          create: {
            hash,
            status,
          },
          update: {
            hash,
            status,
          },
        },
      },
    },
    include: jobInclude,
  });
  return mapJobWithStatus(job);
}
