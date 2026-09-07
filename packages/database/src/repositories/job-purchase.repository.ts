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
  /**
   * The payment node's purchase id. Writable on update because the node can
   * replace a purchase row: the job purchase is then found by the job's
   * blockchain identifier and this repairs the stale id in the same write.
   */
  externalId?: string;
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

  if (data.externalId !== undefined) {
    updateData.externalId = data.externalId;
  }
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

export const jobPurchaseRepository = {
  async createJobPurchase(
    data: CreateJobPurchaseData,
    tx: Prisma.TransactionClient,
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

  async updateJobPurchaseByJobId(
    jobId: string,
    data: UpdateJobPurchaseData,
    tx: Prisma.TransactionClient,
  ): Promise<JobPurchase> {
    return await tx.jobPurchase.update({
      where: { jobId },
      data: buildUpdateData(data),
    });
  },

  async updateJobPurchaseByExternalId(
    externalId: string,
    data: UpdateJobPurchaseData,
    tx: Prisma.TransactionClient,
  ): Promise<JobPurchase> {
    return await tx.jobPurchase.update({
      where: { externalId },
      data: buildUpdateData(data),
    });
  },
};
