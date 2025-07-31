import { z } from "zod";

import { JobStatus } from "@/lib/db";

export const jobStatusDataSchema = z.object({
  id: z.string().min(1),
  jobStatus: z.nativeEnum(JobStatus),
  externalDisputeUnlockTime: z.string().datetime(),
});

export type JobStatusData = z.infer<typeof jobStatusDataSchema>;
