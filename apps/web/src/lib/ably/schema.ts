import { JobStatus } from "@sokosumi/database";
import * as z from "zod";

export const jobStatusDataSchema = z.object({
  jobId: z.string().min(1),
  jobStatus: z.enum(JobStatus),
  jobStatusSettled: z.boolean(),
});

export type JobStatusData = z.infer<typeof jobStatusDataSchema>;
