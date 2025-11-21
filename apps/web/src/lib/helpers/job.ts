import { JobType, type JobWithStatus } from "@sokosumi/database";
import { computeJobStatus } from "@sokosumi/database/helpers";

import { type JobStatusData } from "@/lib/ably";

/**
 * Get the job status data for the job which is used on sidebar job status indicator
 * and used by ably to update the job status in real time.
 * @param job - The job to get the status data for.
 * @returns The job status data.
 */
export function getJobStatusData(job: JobWithStatus): JobStatusData {
  let jobStatusSettled: boolean;
  switch (job.jobType) {
    case JobType.PAID:
      jobStatusSettled = job.externalDisputeUnlockTime
        ? new Date() > job.externalDisputeUnlockTime
        : false;
      break;
    case JobType.DEMO:
      jobStatusSettled = true;
      break;
    case JobType.FREE:
      jobStatusSettled = job.completedAt != null;
      break;
    default:
      jobStatusSettled = false;
      break;
  }

  return {
    jobId: job.id,
    jobStatus: computeJobStatus(job),
    jobStatusSettled,
  };
}

export function isSharedPublicly(job: JobWithStatus): boolean {
  return job.share !== null && job.share.token !== null;
}

export function isSharedWithOrganization(
  job: JobWithStatus,
  organizationId?: string | null,
): boolean {
  if (!organizationId) {
    return false;
  }
  return job.share !== null && job.share.organizationId === organizationId;
}
