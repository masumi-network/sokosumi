import { JobStatus } from "@sokosumi/database";
import * as z from "zod";

export const jobIndicatorStatusSchema = z.object({
  jobId: z.string().min(1),
  jobStatus: z.enum(JobStatus),
  jobStatusSettled: z.boolean(),
});

export type JobIndicatorStatus = z.infer<typeof jobIndicatorStatusSchema>;
