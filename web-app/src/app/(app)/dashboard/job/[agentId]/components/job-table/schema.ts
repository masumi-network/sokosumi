import { z } from "zod";

export const jobSchema = z.object({
  id: z.string(),
  status: z.enum(["Pending", "Completed", "Failed", "Cancelled"]),
  startedTime: z.string().datetime(),
  finishedTime: z.string().datetime().optional(),
  cost: z.number().positive(),
  txId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  input: z.string(),
  result: z.string().optional(),
});

export type Job = z.infer<typeof jobSchema>;
export type JobStatus = Job["status"];
