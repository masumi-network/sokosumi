import { z } from "zod";

import { jobInputSchema } from "@/lib/job-input";

export const startJobInputSchema = z.object({
  userId: z.string(),
  agentId: z.string(),
  maxAcceptedCents: z.bigint(),
  inputSchema: z.array(jobInputSchema()),
  inputData: z.map(
    z.string(),
    z.union([z.number(), z.string(), z.boolean(), z.array(z.number())]),
  ),
});

export const startJobResponseSchema = z.object({
  status: z.enum(["success", "error"]),
  job_id: z.string().min(1),
  blockchainIdentifier: z.string().min(1),
  payByTime: z.number({ coerce: true }).int(),
  submitResultTime: z.number({ coerce: true }).int(),
  unlockTime: z.number({ coerce: true }).int(),
  externalDisputeUnlockTime: z.number({ coerce: true }).int(),
  agentIdentifier: z.string().min(1),
  sellerVkey: z.string().min(1),
  identifierFromPurchaser: z.string().min(1),
  amounts: z.array(
    z.object({
      amount: z.number({ coerce: true }),
      unit: z.string(),
    }),
  ),
  input_hash: z.string().min(1),
});

export const jobStatusResponseSchema = z.object({
  job_id: z.string(),
  status: z.enum([
    "pending",
    "awaiting_payment",
    "awaiting_input",
    "running",
    "completed",
    "failed",
  ]),
  message: z.string().nullish(),
  input_data: z.array(jobInputSchema()).nullish(),
  result: z.string().nullish(),
});

export type StartJobInputSchemaType = z.infer<typeof startJobInputSchema>;
export type StartJobResponseSchemaType = z.infer<typeof startJobResponseSchema>;
export type JobStatusResponseSchemaType = z.infer<
  typeof jobStatusResponseSchema
>;
