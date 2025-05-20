import {
  AgentJobStatus,
  OnChainJobStatus,
  Prisma,
} from "@/prisma/generated/client";

export const jobInclude = {
  agent: true,
  user: true,
  onChainTransaction: true,
} as const;

export const jobOrderBy = {
  createdAt: "desc",
} as const;

export type JobWithRelations = Prisma.JobGetPayload<{
  include: typeof jobInclude;
}>;

export enum JobErrorNoteKeys {
  StatusMismatch = "Job.StatusMismatch",
  Unknown = "Job.UnknownState",
}

export enum JobStatus {
  COMPLETED = "completed",
  FAILED = "failed",
  PAYMENT_PENDING = "payment_pending",
  PAYMENT_FAILED = "payment_failed",
  PROCESSING = "processing",
  INPUT_REQUIRED = "input_required",
  REFUND_PENDING = "refund_pending",
  REFUND_RESOLVED = "refund_resolved",
  DISPUTE_PENDING = "dispute_pending",
  DISPUTE_RESOLVED = "dispute_resolved",
}

export const finalizedOnChainJobStatuses: OnChainJobStatus[] = [
  OnChainJobStatus.DISPUTED_WITHDRAWN,
  OnChainJobStatus.FUNDS_WITHDRAWN,
  OnChainJobStatus.REFUND_WITHDRAWN,
];

export const finalizedAgentJobStatuses: AgentJobStatus[] = [
  AgentJobStatus.COMPLETED,
  AgentJobStatus.FAILED,
];
