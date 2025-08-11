import { z } from "zod";

import { jobInputSchema } from "@/lib/job-input";

export const startJobInputSchema = z.object({
  userId: z.string(),
  agentId: z.string(),
  maxAcceptedCents: z.bigint(),
  inputSchema: z.array(jobInputSchema()),
  inputData: z.map(
    z.string(),
    z.union([
      z.number(),
      z.string(),
      z.boolean(),
      z.array(z.number()),
      z.undefined(),
    ]),
  ),
});

export type StartJobInputSchemaType = z.infer<typeof startJobInputSchema>;

export const jobDetailsNameFormSchema = (
  t?: IntlTranslation<"App.Agents.Jobs.JobDetails.Header.JobName.Schema">,
) =>
  z.object({
    name: z
      .string({ message: t?.("Name.invalid") })
      .min(2, { message: t?.("Name.min") })
      .max(80, { message: t?.("Name.max") })
      .or(z.literal("")),
  });

export type JobDetailsNameFormSchemaType = z.infer<
  ReturnType<typeof jobDetailsNameFormSchema>
>;

// this isn't for user's use, only for internal use
export const startJobResponseSchema = z.object({
  status: z.enum(["success", "error"]),
  job_id: z.string().min(1),
  blockchainIdentifier: z.string().min(1),
  payByTime: z.coerce.number().int(),
  submitResultTime: z.coerce.number().int(),
  unlockTime: z.coerce.number().int(),
  externalDisputeUnlockTime: z.coerce.number().int(),
  agentIdentifier: z.string().min(1),
  sellerVKey: z.string().min(1),
  identifierFromPurchaser: z.string().min(1),
  amounts: z.array(
    z.object({
      unit: z.string(),
      amount: z.coerce.number().int().positive(),
    }),
  ),
  input_hash: z.string().min(1),
});
export type StartJobResponseSchemaType = z.infer<typeof startJobResponseSchema>;

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

export type JobStatusResponseSchemaType = z.infer<
  typeof jobStatusResponseSchema
>;
