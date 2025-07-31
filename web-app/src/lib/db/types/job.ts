import {
  AgentJobStatus,
  OnChainJobStatus,
  Prisma,
} from "@/prisma/generated/client";

export const jobInclude = {
  agent: true,
  user: true,
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
  PROCESSING = "processing",
  INPUT_REQUIRED = "input_required",
  OUTPUT_PENDING = "output_pending", // Result is submitted on-chain, but not available by the agent
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
];

export const finalizedAgentJobStatuses: AgentJobStatus[] = [
  AgentJobStatus.COMPLETED,
];

export type JobWithStatus = JobWithRelations & {
  status: JobStatus;
  jobStatusSettled: boolean;
};

export const jobLimitedInclude = {
  id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
  agentJobStatus: true,
  onChainStatus: true,
} as const;

export type JobWithLimitedInformation = Prisma.JobGetPayload<{
  select: typeof jobLimitedInclude;
}>;
