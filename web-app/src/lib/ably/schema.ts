import { z } from "zod";

import { JobStatus } from "@/lib/db";
import { AgentJobStatus, OnChainJobStatus } from "@/prisma/generated/client";

export const jobStatusDataSchema = z.object({
  id: z.string().min(1),
  jobStatus: z.nativeEnum(JobStatus),
  onChainStatus: z.nativeEnum(OnChainJobStatus).nullish(),
  agentJobStatus: z.nativeEnum(AgentJobStatus).nullish(),
});

export type JobStatusData = z.infer<typeof jobStatusDataSchema>;
