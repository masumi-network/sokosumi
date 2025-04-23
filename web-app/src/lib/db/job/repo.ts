"use server";

import {
  CreditsPrice,
  jobCreditTransactionInclude,
  jobInclude,
  jobOrderBy,
  JobWithCreditTransaction,
  JobWithRelations,
  prisma,
} from "@/lib/db";
import {
  CreditTransaction,
  Job,
  JobStatus,
  Prisma,
} from "@/prisma/generated/client";

/**
 * Retrieves all jobs associated with a specific user
 * @param userId - The unique identifier of the user
 * @returns Promise containing an array of jobs with their relations
 */
export async function getJobsByUserId(
  userId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  return await tx.job.findMany({
    where: {
      userId,
    },
    include: jobInclude,
    orderBy: jobOrderBy,
  });
}

/**
 * Retrieves all jobs associated with a specific agent and user
 * @param agentId - The unique identifier of the agent
 * @param userId - The unique identifier of the user
 * @returns Promise containing an array of jobs with their relations
 */
export async function getJobsByAgentId(
  agentId: string,
  userId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobWithRelations[]> {
  const jobs = await tx.job.findMany({
    where: {
      agentId,
      userId,
    },
    include: jobInclude,
    orderBy: jobOrderBy,
  });

  if (!jobs) {
    return [];
  }

  return jobs;
}

export async function getJobById(
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  return await tx.job.findUnique({
    where: { id: jobId },
    include: jobInclude,
  });
}

export async function getJobByIdWithCreditTransaction(
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<JobWithCreditTransaction | null> {
  return await tx.job.findUnique({
    where: {
      id: jobId,
    },
    include: jobCreditTransactionInclude,
  });
}

interface CreateJobData {
  agentJobId: string;
  agentId: string;
  userId: string;
  input: string;
  jobStatus: JobStatus;
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
      status: data.jobStatus,
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

export async function updateJobStatusToAgentConnectionFailed(
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.AGENT_CONNECTION_FAILED,
    },
  });
}

export async function updateJobStatusToPaymentNodeConnectionFailed(
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.PAYMENT_NODE_CONNECTION_FAILED,
    },
  });
}

export async function updateJobStatusToUnknown(
  jobId: string,
  errorNote?: string,
  errorNoteKey?: string,
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.job.update({
    where: {
      id: jobId,
    },
    data: {
      status: JobStatus.UNKNOWN,
      errorNote,
      errorNoteKey,
    },
  });
}

export async function updateJobStatusToPaymentPending(
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.job.update({
    where: {
      id: jobId,
    },
    data: { status: JobStatus.PAYMENT_PENDING },
  });
}

export async function updateJobStatusToPaymentFailed(
  jobId: string,
  creditTransaction: CreditTransaction,
  errorType?: PurchaseErrorType,
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.job.update({
    where: {
      id: jobId,
    },
    data: {
      status: JobStatus.PAYMENT_FAILED,
      errorType,
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
      finishedAt: new Date(),
    },
  });
}

export async function updateJobStatusToDisputeRequested(
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.job.update({
    where: {
      id: jobId,
    },
    data: { status: JobStatus.DISPUTE_REQUESTED },
  });
}

export async function updateJobStatusToDisputeResolved(
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.job.update({
    where: {
      id: jobId,
    },
    data: { status: JobStatus.DISPUTE_RESOLVED, finishedAt: new Date() },
  });
}

export async function updateJobStatusToRefundRequested(
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.job.update({
    where: {
      id: jobId,
    },
    data: { status: JobStatus.REFUND_REQUESTED },
  });
}

export async function updateJobStatusToRefundResolved(
  jobId: string,
  creditTransaction: CreditTransaction,
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.job.update({
    where: {
      id: jobId,
    },
    data: {
      status: JobStatus.REFUND_RESOLVED,
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
      finishedAt: new Date(),
    },
  });
}

export async function updateJobStatusToInputRequired(
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.job.update({
    where: {
      id: jobId,
    },
    data: { status: JobStatus.INPUT_REQUIRED },
  });
}

export async function updateJobStatusToProcessing(
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.job.update({
    where: {
      id: jobId,
    },
    data: { status: JobStatus.PROCESSING },
  });
}

export async function updateJobStatusToFailed(
  jobId: string,
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.job.update({
    where: {
      id: jobId,
    },
    data: { status: JobStatus.FAILED },
  });
}

export async function updateJobStatusToCompleted(
  jobId: string,
  output: string,
  tx: Prisma.TransactionClient = prisma,
) {
  await tx.job.update({
    where: {
      id: jobId,
    },
    data: {
      status: JobStatus.COMPLETED,
      output,
      finishedAt: new Date(),
    },
  });
}
