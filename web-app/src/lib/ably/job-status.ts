import { v4 as uuidv4 } from "uuid";

import { Job, Prisma } from "@/prisma/generated/client";

export function makeJobStatusUpdateMutation(
  job: Job,
): Prisma.OutboxCreateInput {
  return {
    mutation_id: uuidv4(),
    channel: makeJobStatusUpdateChannel(job.id),
    name: "job_status_update",
    data: job,
  };
}

export function makeJobStatusUpdateChannel(jobId: string): string {
  return `job:${jobId}`;
}
