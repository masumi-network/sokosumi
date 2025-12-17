import { inputSchema, inputsSchema } from "@sokosumi/masumi/schemas";
import * as z from "zod";

import { JobScheduleType } from "@/lib/types/job";

export const startJobInputSchema = z.object({
  userId: z.string(),
  organizationId: z.string().nullish(),
  agentId: z.string(),
  maxAcceptedCents: z.bigint(),
  inputSchema: z.array(inputSchema),
  inputData: z.record(
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
  jobScheduleId: z.string().nullish(),
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

// Preprocess helper for backwards compatibility: normalize job_id to id
// Id is required in the Masumi Docs, but some agents return job_id instead.
function preprocessJobId(val: unknown): unknown {
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, unknown>;
    return {
      ...obj,
      id: obj.id ?? obj.job_id,
    };
  }
  return val;
}

// Base schema for FREE jobs with preprocessing
export const startFreeJobResponseSchema = z.preprocess(
  preprocessJobId,
  z.object({
    id: z.string().min(1),
  }),
);

export type StartFreeJobResponseSchemaType = z.infer<
  typeof startFreeJobResponseSchema
>;

// Schema for PAID jobs with preprocessing (cannot extend preprocessed schema)
export const startPaidJobResponseSchema = z.preprocess(
  preprocessJobId,
  z.object({
    id: z.string().min(1),
    input_hash: z.string().min(1),
    identifierFromPurchaser: z.string().min(1),
    blockchainIdentifier: z.string().min(1),
    payByTime: z.coerce.number().int(),
    submitResultTime: z.coerce.number().int(),
    unlockTime: z.coerce.number().int(),
    externalDisputeUnlockTime: z.coerce.number().int(),
    agentIdentifier: z.string().min(1),
    sellerVKey: z.string().min(1),
  }),
);

export type StartPaidJobResponseSchemaType = z.infer<
  typeof startPaidJobResponseSchema
>;

// Keep original for backwards compatibility (uses paid schema)
export const startJobResponseSchema = startPaidJobResponseSchema;
export type StartJobResponseSchemaType = StartPaidJobResponseSchemaType;

// Helper function to create a conditional required field validation
function requireFieldWhenStatus<T extends Record<string, unknown>>(
  status: string,
  fieldName: string,
  fieldLabel?: string,
) {
  return (data: T, ctx: z.RefinementCtx) => {
    if (data.status === status) {
      const value = data[fieldName];
      const isEmpty =
        value == null ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === "string" && value.length === 0);

      if (isEmpty) {
        ctx.addIssue({
          code: "custom",
          message: `${fieldLabel ?? fieldName} is required when status is ${status}`,
          path: [fieldName],
        });
      }
    }
  };
}

// Agent job status values - single source of truth
export const JOB_STATUS_VALUES = [
  "awaiting_payment",
  "awaiting_input",
  "running",
  "completed",
  "failed",
] as const;

export type JobStatusValue = (typeof JOB_STATUS_VALUES)[number];

export const jobStatusResponseSchema = z
  .object({
    id: z.string().nullish(),
    status: z.enum(JOB_STATUS_VALUES),
    input_schema: inputsSchema.nullish(),
    result: z.string().nullish(),
  })
  .superRefine((data, ctx) => {
    requireFieldWhenStatus("awaiting_input", "input_schema")(data, ctx);
    requireFieldWhenStatus("completed", "result")(data, ctx);
  });

export type JobStatusResponseSchemaType = z.infer<
  typeof jobStatusResponseSchema
>;

export const provideJobInputResponseSchema = z.object({
  input_hash: z.string(),
  signature: z.string(),
});

export type ProvideJobInputResponseSchemaType = z.infer<
  typeof provideJobInputResponseSchema
>;

export const createJobScheduleInputSchema = z.object({
  agentId: z.string(),
  userId: z.string(),
  organizationId: z.string().nullish(),
  scheduleType: z.nativeEnum(JobScheduleType),
  cron: z.string().nullish(),
  oneTimeAtUtc: z.string().nullish(),
  timezone: z.string(),
  inputSchema: z.array(inputSchema),
  inputData: z.record(
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
  maxAcceptedCents: z.bigint(),
  endOnUtc: z.string().nullish(),
  endAfterOccurrences: z.number().int().positive().nullish(),
  isActive: z.boolean().default(true),
  pauseReason: z.string().nullish(),
  nextRunAt: z.string().nullish(),
});

export type CreateJobScheduleInputSchemaType = z.infer<
  typeof createJobScheduleInputSchema
>;

export const provideJobInputSchema = z.object({
  jobId: z.string(),
  statusId: z.string(),
  inputData: z.record(
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

export type ProvideJobInputSchemaType = z.infer<typeof provideJobInputSchema>;
