import type { JobStatusData } from "@/lib/ably";
import type { Job, JobSummary } from "@/lib/clients/generated/core";

/**
 * Job status payload for the sidebar indicator and Ably realtime updates.
 * Prefer `jobStatusSettled` from Core `JobSummary` / `Job` DTOs.
 */
export function getJobStatusData(job: JobSummary | Job): JobStatusData {
  return {
    jobId: job.id,
    jobStatus: job.status,
    jobStatusSettled: job.jobStatusSettled,
  };
}

export function isSharedPublicly(job: Job): boolean {
  return job.share !== null && job.share.token !== null;
}
