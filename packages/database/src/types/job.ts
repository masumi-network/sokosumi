import {
  AgentJobStatus,
  OnChainJobStatus,
} from "../generated/prisma/browser.js";
import type {
  JobType,
  Prisma,
  Transaction,
} from "../generated/prisma/client.js";

export const jobWithEvents = {
  events: {
    orderBy: {
      createdAt: "asc",
    },
    include: {
      blobs: true,
      input: {
        include: {
          attachments: true,
        },
      },
      links: true,
    },
  },
} as const;

export type JobWithEvents = Prisma.JobGetPayload<{
  include: typeof jobWithEvents;
}>;

export const jobWithPurchase = {
  purchase: true,
} as const;

export type JobWithPurchase = Prisma.JobGetPayload<{
  include: typeof jobWithPurchase;
}>;

export const jobWithTransaction = {
  transaction: true,
} as const;

export type JobWithTransaction = Prisma.JobGetPayload<{
  include: typeof jobWithTransaction;
}>;

export const jobWithRefundedTransaction = {
  refundedTransaction: true,
} as const;

export type JobWithRefundedTransaction = Prisma.JobGetPayload<{
  include: typeof jobWithRefundedTransaction;
}>;

export const jobWithAgent = {
  agent: true,
} as const;

export type JobWithAgent = Prisma.JobGetPayload<{
  include: typeof jobWithAgent;
}>;

export const jobWithUser = {
  user: true,
} as const;

export type JobWithUser = Prisma.JobGetPayload<{
  include: typeof jobWithUser;
}>;

export const jobWithOrganization = {
  organization: true,
} as const;

export type JobWithOrganization = Prisma.JobGetPayload<{
  include: typeof jobWithOrganization;
}>;

export const jobWithShare = {
  share: true,
} as const;

export type JobWithShare = Prisma.JobGetPayload<{
  include: typeof jobWithShare;
}>;

export const jobInclude = {
  ...jobWithEvents,
  ...jobWithPurchase,
  ...jobWithAgent,
  ...jobWithUser,
  ...jobWithOrganization,
  ...jobWithTransaction,
  ...jobWithRefundedTransaction,
  ...jobWithShare,
} as const;

export const jobOrderBy = {
  createdAt: "desc",
} as const;

export type JobWithRelations = Prisma.JobGetPayload<{
  include: typeof jobInclude;
}>;

export type JobEventWithRelations = Prisma.JobEventGetPayload<{
  include: {
    input: {
      include: {
        attachments: true;
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
  events: JobEventWithRelations[];
  credits: number;
  cents: bigint;
  resultHash: string | null;
  result: string | null;
};

type BaseFreeJob = {
  jobType: typeof JobType.FREE;
  transaction: null;
  transactionId: null;
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
  transaction: null;
  transactionId: null;
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
  transaction: Transaction;
  transactionId: string;
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
