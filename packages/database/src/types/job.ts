import {
  AgentJobStatus,
  OnChainJobStatus,
} from "../generated/prisma/browser.js";
import type {
  CreditTransaction,
  JobType,
  Prisma,
} from "../generated/prisma/client.js";

export const jobInclude = {
  statuses: {
    orderBy: {
      createdAt: "asc",
    },
    include: {
      blobs: true,
      input: {
        include: {
          blobs: true,
        },
      },
      links: true,
    },
  },
  inputBlobs: true,
  purchase: true,
  agent: true,
  user: true,
  organization: true,
  creditTransaction: true,
  refundedCreditTransaction: true,
  share: true,
} as const;

export const jobOrderBy = {
  createdAt: "desc",
} as const;

export type JobWithRelations = Prisma.JobGetPayload<{
  include: typeof jobInclude;
}>;

export type JobStatusWithRelations = Prisma.JobStatusGetPayload<{
  include: {
    input: {
      include: {
        blobs: true;
      };
    };
    blobs: true;
    links: true;
  };
}>;

type Override<TType, TWith> = Omit<TType, keyof TWith> & TWith;

type BaseJobWithStatus = JobWithRelations & {
  status: SokosumiJobStatus;
  jobStatusSettled: boolean;
  completedAt: Date | null;
  input: string | null;
  inputSchema: string | null;
  inputHash: string | null;
  statuses: JobStatusWithRelations[];
  credits: number;
  cents: bigint;
  resultHash: string | null;
  result: string | null;
};

type BaseFreeJob = {
  jobType: typeof JobType.FREE;
  creditTransaction: null;
  creditTransactionId: null;
  identifierFromPurchaser: null;
  blockchainIdentifier: null;
  payByTime: null;
  submitResultTime: null;
  unlockTime: null;
  externalDisputeUnlockTime: null;
  sellerVkey: null;
  purchaseId: null;
  inputHash: null;
  resultHash: null;
  onChainStatus: null;
  onChainTransactionHash: null;
  onChainTransactionStatus: null;
};

type BaseDemoJob = {
  jobType: typeof JobType.DEMO;
  creditTransaction: null;
  creditTransactionId: null;
  identifierFromPurchaser: null;
  blockchainIdentifier: null;
  payByTime: null;
  submitResultTime: null;
  unlockTime: null;
  externalDisputeUnlockTime: null;
  sellerVkey: null;
  purchaseId: null;
  inputHash: null;
  resultHash: null;
  onChainStatus: null;
  onChainTransactionHash: null;
  onChainTransactionStatus: null;
};

type BasePaidJob = {
  jobType: typeof JobType.PAID;
  creditTransaction: CreditTransaction;
  creditTransactionId: string;
  blockchainIdentifier: string;
  payByTime: Date;
  submitResultTime: Date;
  unlockTime: Date;
  externalDisputeUnlockTime: Date;
  sellerVkey: string;
  identifierFromPurchaser: string;
};

export type FreeJobWithStatus = Override<BaseJobWithStatus, BaseFreeJob>;

export type DemoJobWithStatus = Override<BaseJobWithStatus, BaseDemoJob>;

export type PaidJobWithStatus = Override<BaseJobWithStatus, BasePaidJob>;

export enum JobErrorNoteKeys {
  StatusMismatch = "Job.StatusMismatch",
  Unknown = "Job.UnknownState",
}

export enum SokosumiJobStatus {
  STARTED = "started",
  COMPLETED = "completed",
  PROCESSING = "processing",
  INPUT_REQUIRED = "input_required",
  RESULT_PENDING = "result_pending",
  FAILED = "failed",

  PAYMENT_PENDING = "payment_pending",
  PAYMENT_FAILED = "payment_failed",

  REFUND_PENDING = "refund_pending",
  REFUND_RESOLVED = "refund_resolved",

  DISPUTE_PENDING = "dispute_pending",
  DISPUTE_RESOLVED = "dispute_resolved",
}

export const finalizedOnChainJobStatuses: OnChainJobStatus[] = [
  OnChainJobStatus.DISPUTED_WITHDRAWN,
  OnChainJobStatus.FUNDS_WITHDRAWN,
  OnChainJobStatus.REFUND_WITHDRAWN,
  OnChainJobStatus.RESULT_SUBMITTED,
];

export const finalizedAgentJobStatuses: AgentJobStatus[] = [
  AgentJobStatus.COMPLETED,
  AgentJobStatus.FAILED,
];

export type JobWithSokosumiStatus =
  | FreeJobWithStatus
  | PaidJobWithStatus
  | DemoJobWithStatus;
