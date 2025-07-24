import { v4 as uuidv4 } from "uuid";
import { z } from "zod";

import { JobStatus } from "@/lib/db";
import {
  AgentJobStatus,
  OnChainJobStatus,
  Prisma,
} from "@/prisma/generated/client";

export const jobStatusDataSchema = z.object({
  id: z.string().min(1),
  jobStatus: z.nativeEnum(JobStatus),
  onChainStatus: z.nativeEnum(OnChainJobStatus).nullish(),
  agentJobStatus: z.nativeEnum(AgentJobStatus).nullish(),
});

export type JobStatusData = z.infer<typeof jobStatusDataSchema>;

export function makeJobStatusMutation(
  jobStatusData: JobStatusData,
): Prisma.OutboxCreateInput {
  return {
    mutation_id: uuidv4(),
    channel: makeJobStatusChannel(jobStatusData.id),
    name: "job_status_update",
    data: jobStatusData,
  };
}

export function makeJobStatusChannel(jobId: string): string {
  return `job:${jobId}`;
}
