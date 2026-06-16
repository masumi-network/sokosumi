import type { SokosumiJobStatus } from "../sokosumi-job-status.js";
import {
  AgentJobStatus,
  JobType,
  OnChainJobStatus,
  type OnChainTransactionStatus,
} from "./enums.js";
import type {
  Job,
  JobAgentSummary,
  JobEvent,
  JobOrganizationSummary,
  JobPurchase,
  JobUserSummary,
  JobWorkspaceSummary,
  PublicShare,
  Transaction,
} from "./models.js";

export type JobEventWithRelations = JobEvent;

export type JobWithEvents = Job & {
  events: JobEventWithRelations[];
};

export type JobWithPurchase = Job & {
  purchase: JobPurchase | null;
};

export type JobWithTransaction = Job & {
  transaction: Transaction | null;
};

export type JobWithRefundedTransaction = Job & {
  refundedTransaction: Transaction | null;
};

export type JobWithShare = Job & {
  share: PublicShare | null;
};

export type JobWithAgent = Job & {
  agent: JobAgentSummary;
};

export type JobWithUser = Job & {
  user: JobUserSummary;
};

export type JobWithOrganization = Job & {
  organization: JobOrganizationSummary | null;
};

export type JobWithWorkspace = Job & {
  workspace: JobWorkspaceSummary;
};

export type JobWithSummaryRelations = Job &
  JobWithEvents &
  JobWithTransaction &
  JobWithPurchase &
  JobWithUser &
  JobWithOrganization &
  JobWithWorkspace;

export type JobWithRelations = JobWithSummaryRelations &
  JobWithAgent &
  JobWithRefundedTransaction &
  JobWithShare;

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
  onChainStatus: OnChainJobStatus | null;
  onChainTransactionHash: string | null;
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

export type JobWithSokosumiStatus =
  | FreeJobWithStatus
  | PaidJobWithStatus
  | DemoJobWithStatus;

export const finalizedOnChainJobStatuses = [
  OnChainJobStatus.DISPUTED_WITHDRAWN,
  OnChainJobStatus.FUNDS_WITHDRAWN,
  OnChainJobStatus.REFUND_WITHDRAWN,
  OnChainJobStatus.FUNDS_OR_DATUM_INVALID,
] as const satisfies readonly OnChainJobStatus[];

export const finalizedAgentJobStatuses = [
  AgentJobStatus.COMPLETED,
  AgentJobStatus.FAILED,
] as const satisfies readonly AgentJobStatus[];
