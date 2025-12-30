import {
  inputFieldSchema,
  InputFieldSchemaType,
  inputFieldsSchema,
  inputGroupsSchema,
  inputSchema,
  inputSchemaResponseSchema,
  inputSchemaSchema,
  InputSchemaSchemaType,
} from "@sokosumi/masumi/schemas";
import * as z from "zod";

import { JobScheduleType } from "@/lib/types/job";

export const startJobInputSchema = z.object({
  userId: z.string(),
  organizationId: z.string().nullish(),
  agentId: z.string(),
  maxAcceptedCents: z.bigint(),
  inputSchema: z.array(inputFieldSchema),
  inputData: inputSchema,
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
    input_schema: inputSchemaResponseSchema.nullish(),
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
  inputSchema: z.array(inputFieldSchema),
  inputData: inputSchema,
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
  inputData: inputSchema,
});

export type ProvideJobInputSchemaType = z.infer<typeof provideJobInputSchema>;

const groupedInputSchema = z.object({ input_groups: inputGroupsSchema });

type GroupedInputSchema = z.infer<typeof groupedInputSchema>;

export function isGroupedSchema(
  schema: InputSchemaSchemaType,
): schema is GroupedInputSchema {
  return groupedInputSchema.safeParse(schema).success;
}

export function flattenInputs(
  schema: InputSchemaSchemaType,
): InputFieldSchemaType[] {
  if (isGroupedSchema(schema)) {
    return schema.input_groups.flatMap((group) => group.input_data);
  }
  return schema.input_data;
}

export function normalizeAndValidateInputSchema(
  parsed: unknown,
): InputSchemaSchemaType | null {
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const result = inputSchemaSchema.safeParse(parsed);
    if (result.success) {
      return result.data;
    }

    console.error(
      "[normalizeAndValidateInputSchema] Invalid object schema:",
      result.error,
    );
    return null;
  }

  if (Array.isArray(parsed)) {
    const groupsResult = inputGroupsSchema.safeParse(parsed);
    if (groupsResult.success) {
      return { input_groups: groupsResult.data };
    }

    const fieldsResult = inputFieldsSchema.safeParse(parsed);
    if (fieldsResult.success) {
      return { input_data: fieldsResult.data };
    }

    console.error(
      "[normalizeAndValidateInputSchema] Invalid array schema:",
      groupsResult.error,
      fieldsResult.error,
    );
    return null;
  }

  console.error(
    "[normalizeAndValidateInputSchema] Unexpected schema format:",
    typeof parsed,
  );
  return null;
}
