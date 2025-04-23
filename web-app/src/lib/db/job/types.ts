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

export const finalizedJobStates: JobStatus[] = [
  JobStatus.COMPLETED,
  JobStatus.PAYMENT_FAILED,
  JobStatus.DISPUTE_RESOLVED,
  JobStatus.REFUND_RESOLVED,
];

export const allJobStates: JobStatus[] = Object.values(JobStatus);

export const pendingJobStates: JobStatus[] = allJobStates.filter(
  (state) => !finalizedJobStates.includes(state),
);
