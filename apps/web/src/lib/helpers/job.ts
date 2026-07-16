import type { JobStatusData } from "@/lib/ably";
import type { Job, JobSummary } from "@/lib/clients/generated/core";
import { JobType } from "@/lib/clients/generated/core";

export type CoreJobListItem = JobSummary & {
  jobStatusSettled?: boolean;
};

type JobWithSettlementFields = Pick<
  JobSummary,
  "jobType" | "completedAt" | "externalDisputeUnlockTime"
>;

export function isJobSettled(job: JobWithSettlementFields): boolean {
  switch (job.jobType) {
    case JobType.FREE:
      return job.completedAt != null;
    case JobType.PAID:
      return job.externalDisputeUnlockTime
        ? new Date() > job.externalDisputeUnlockTime
        : false;
    default:
      return false;
  }
}

/**
 * Get the job status data for the job which is used on sidebar job status indicator
 * and used by ably to update the job status in real time.
 */
export function getJobStatusData(
  job: JobSummary | Job | CoreJobListItem,
): JobStatusData {
  return {
    jobId: job.id,
    jobStatus: job.status,
    jobStatusSettled: isJobSettled(job),
  };
}

export function isSharedPublicly(job: Job): boolean {
  return job.share !== null && job.share.token !== null;
}
