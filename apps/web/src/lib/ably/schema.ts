import { SokosumiJobStatus } from "@sokosumi/database";
import * as z from "zod";

export const jobStatusDataSchema = z.object({
  jobId: z.string().min(1),
  jobStatus: z.enum(SokosumiJobStatus),
  jobStatusSettled: z.boolean(),
});

export type JobStatusData = z.infer<typeof jobStatusDataSchema>;

export const taskEventDataSchema = z.object({
  taskId: z.string().min(1),
  eventType: z.literal("task_event"),
});

export type TaskEventData = z.infer<typeof taskEventDataSchema>;
