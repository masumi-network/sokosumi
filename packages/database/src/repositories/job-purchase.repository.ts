import prisma from "../client.js";
import type {
  JobPurchase,
  NextJobAction,
  NextJobActionErrorType,
  OnChainJobStatus,
  OnChainTransactionStatus,
  Prisma,
} from "../generated/prisma/client.js";

interface CreateJobPurchaseData {
  externalId: string;
  jobId: string;
  onChainStatus?: OnChainJobStatus | null;
  onChainTransactionHash?: string | null;
  onChainTransactionStatus?: OnChainTransactionStatus | null;
  resultHash?: string | null;
  nextAction?: NextJobAction;
  nextActionErrorType?: NextJobActionErrorType | null;
  nextActionErrorNote?: string | null;
  errorNote?: string | null;
  errorNoteKey?: string | null;
}

interface UpdateJobPurchaseData {
  onChainStatus?: OnChainJobStatus | null;
  onChainTransactionHash?: string | null;
  onChainTransactionStatus?: OnChainTransactionStatus | null;
  resultHash?: string | null;
  nextAction?: NextJobAction;
  nextActionErrorType?: NextJobActionErrorType | null;
  nextActionErrorNote?: string | null;
  errorNote?: string | null;
  errorNoteKey?: string | null;
}

/**
 * Builds a Prisma update data object by only including fields that are explicitly provided (not undefined).
 */
function buildUpdateData(
  data: UpdateJobPurchaseData,
): Prisma.JobPurchaseUpdateInput {
  const updateData: Prisma.JobPurchaseUpdateInput = {};

  if (data.onChainStatus !== undefined) {
    updateData.onChainStatus = data.onChainStatus;
  }
  if (data.onChainTransactionHash !== undefined) {
    updateData.onChainTransactionHash = data.onChainTransactionHash;
  }
  if (data.onChainTransactionStatus !== undefined) {
    updateData.onChainTransactionStatus = data.onChainTransactionStatus;
  }
  if (data.resultHash !== undefined) {
    updateData.resultHash = data.resultHash;
  }
  if (data.nextAction !== undefined) {
    updateData.nextAction = data.nextAction;
  }
  if (data.nextActionErrorType !== undefined) {
    updateData.nextActionErrorType = data.nextActionErrorType;
  }
  if (data.nextActionErrorNote !== undefined) {
    updateData.nextActionErrorNote = data.nextActionErrorNote;
  }
  if (data.errorNote !== undefined) {
    updateData.errorNote = data.errorNote;
  }
  if (data.errorNoteKey !== undefined) {
    updateData.errorNoteKey = data.errorNoteKey;
  }

  return updateData;
}

/**
 * Repository for managing JobPurchase entities and related queries.
 * Provides methods for creating, retrieving, updating, and deleting JobPurchase records.
 */
export const jobPurchaseRepository = {
  /**
   * Creates a new JobPurchase record
   */
  async createJobPurchase(
    data: CreateJobPurchaseData,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobPurchase> {
    return await tx.jobPurchase.create({
      data: {
        externalId: data.externalId,
        job: { connect: { id: data.jobId } },
        onChainStatus: data.onChainStatus,
        onChainTransactionHash: data.onChainTransactionHash,
        onChainTransactionStatus: data.onChainTransactionStatus,
        resultHash: data.resultHash,
        nextAction: data.nextAction ?? "NONE",
        nextActionErrorType: data.nextActionErrorType,
        nextActionErrorNote: data.nextActionErrorNote,
        errorNote: data.errorNote,
        errorNoteKey: data.errorNoteKey,
      },
    });
  },

  /**
   * Retrieves a JobPurchase by its ID
   */
  async getJobPurchaseById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobPurchase | null> {
    return await tx.jobPurchase.findUnique({
      where: { id },
    });
  },

  /**
   * Retrieves a JobPurchase by its jobId (unique)
   */
  async getJobPurchaseByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobPurchase | null> {
    return await tx.jobPurchase.findUnique({
      where: { jobId },
    });
  },

  /**
   * Retrieves a JobPurchase by its externalId (unique)
   */
  async getJobPurchaseByExternalId(
    externalId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobPurchase | null> {
    return await tx.jobPurchase.findUnique({
      where: { externalId },
    });
  },

  /**
   * Updates a JobPurchase by its ID
   */
  async updateJobPurchaseById(
    id: string,
    data: UpdateJobPurchaseData,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobPurchase> {
    return await tx.jobPurchase.update({
      where: { id },
      data: buildUpdateData(data),
    });
  },

  /**
   * Updates a JobPurchase by its jobId
   */
  async updateJobPurchaseByJobId(
    jobId: string,
    data: UpdateJobPurchaseData,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobPurchase> {
    return await tx.jobPurchase.update({
      where: { jobId },
      data: buildUpdateData(data),
    });
  },

  /**
   * Updates a JobPurchase by its externalId
   */
  async updateJobPurchaseByExternalId(
    externalId: string,
    data: UpdateJobPurchaseData,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobPurchase> {
    return await tx.jobPurchase.update({
      where: { externalId },
      data: buildUpdateData(data),
    });
  },

  /**
   * Deletes a JobPurchase by its ID
   */
  async deleteJobPurchaseById(
    id: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobPurchase> {
    return await tx.jobPurchase.delete({
      where: { id },
    });
  },

  /**
   * Deletes a JobPurchase by its jobId
   */
  async deleteJobPurchaseByJobId(
    jobId: string,
    tx: Prisma.TransactionClient = prisma,
  ): Promise<JobPurchase> {
    return await tx.jobPurchase.delete({
      where: { jobId },
    });
  },
};
