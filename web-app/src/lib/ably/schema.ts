import * as z from "zod";

import { JobStatus } from "@/lib/db";

export const jobIndicatorStatusSchema = z.object({
  jobId: z.string().min(1),
  jobStatus: z.enum(JobStatus),
  jobStatusSettled: z.boolean(),
});

export type JobIndicatorStatus = z.infer<typeof jobIndicatorStatusSchema>;
