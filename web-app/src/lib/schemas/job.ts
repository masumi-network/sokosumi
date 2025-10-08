import * as z from "zod";

import { jobInputSchema } from "@/lib/job-input";

export const startJobInputSchema = z.object({
  userId: z.string(),
  organizationId: z.string().nullish(),
  agentId: z.string(),
  maxAcceptedCents: z.bigint(),
  inputSchema: z.array(jobInputSchema()),
  inputData: z.map(
    z.string(),
    z.union([
      z.number(),
      z.string(),
      z.array(z.string()),
      z.boolean(),
      z.array(z.number()),
      z.instanceof(File),
      z.array(z.instanceof(File)),
      z.undefined(),
    ]),
  ),
});

export type StartJobInputSchemaType = z.infer<typeof startJobInputSchema>;

export const jobDetailsNameFormSchema = (
  t?: IntlTranslation<"Components.Jobs.JobDetails.Header.JobName.Schema">,
) =>
  z.object({
    name: z
      .string({ error: t?.("Name.invalid") })
      .min(2, { error: t?.("Name.min") })
      .max(80, { error: t?.("Name.max") })
      .or(z.literal("")),
  });

export type JobDetailsNameFormSchemaType = z.infer<
  ReturnType<typeof jobDetailsNameFormSchema>
>;

// Base response for FREE jobs
export const startFreeJobResponseSchema = z.object({
  status: z.enum(["success", "error"]),
  job_id: z.string().min(1),
  identifierFromPurchaser: z.string().min(1),
  input_hash: z.string().min(1),
});

export type StartFreeJobResponseSchemaType = z.infer<
  typeof startFreeJobResponseSchema
>;

// Response for PAID jobs (extends FREE schema)
export const startPaidJobResponseSchema = startFreeJobResponseSchema.extend({
  blockchainIdentifier: z.string().min(1),
  payByTime: z.coerce.number().int(),
  submitResultTime: z.coerce.number().int(),
  unlockTime: z.coerce.number().int(),
  externalDisputeUnlockTime: z.coerce.number().int(),
  agentIdentifier: z.string().min(1),
  sellerVKey: z.string().min(1),
  amounts: z.array(
    z.object({
      unit: z.string(),
      amount: z.coerce.bigint().positive(),
    }),
  ),
});

export type StartPaidJobResponseSchemaType = z.infer<
  typeof startPaidJobResponseSchema
>;

// Keep original for backwards compatibility (uses paid schema)
export const startJobResponseSchema = startPaidJobResponseSchema;
export type StartJobResponseSchemaType = StartPaidJobResponseSchemaType;

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
  error: z.string().nullish(),
  input_data: z.array(jobInputSchema()).nullish(),
  result: z.string().nullish(),
});

export type JobStatusResponseSchemaType = z.infer<
  typeof jobStatusResponseSchema
>;
