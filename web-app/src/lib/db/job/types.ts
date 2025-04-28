import { JobStatus, Prisma } from "@/prisma/generated/client";

export const jobInclude = {
  agent: true,
  user: true,
} as const;

export const jobCreditTransactionInclude = {
  creditTransaction: true,
} as const;

export const jobOrderBy = {
  createdAt: "desc",
} as const;

export type JobWithRelations = Prisma.JobGetPayload<{
  include: typeof jobInclude;
}>;

export type JobWithCreditTransaction = Prisma.JobGetPayload<{
  include: typeof jobCreditTransactionInclude;
}>;

export enum JobErrorNoteKeys {
  StatusMismatch = "Job.StatusMismatch",
  Unknown = "Job.UnknownState",
}

export const FinalizedJobStatuses: JobStatus[] = [
  JobStatus.PAYMENT_FAILED,
  JobStatus.COMPLETED,
  JobStatus.REFUND_RESOLVED,
  JobStatus.DISPUTE_RESOLVED,
];
