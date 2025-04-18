import { Prisma } from "@/prisma/generated/client";

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
  "SyncOnChainStateFailed" = "Job.SyncOnChainStateFailed",
  "SyncJobStatusFailed" = "Job.SyncJobStatusFailed",
  "FundsOrDatumInvalid" = "Job.FundsOrDatumInvalid",
  "JobStatusMismatch" = "Job.JobStatusMismatch",
  "ManualOnChainState" = "Job.ManualOnChainState",
}
