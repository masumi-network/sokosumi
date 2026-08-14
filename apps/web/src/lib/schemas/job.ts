import {
  type InputFieldSchemaType,
  type InputSchemaSchemaType,
  inputGroupsSchema,
  inputSchema,
  inputSchemaResponseSchema,
} from "@sokosumi/masumi/schemas";
import * as z from "zod";

/** Must match Core `createJobRequestSchema` / `patchJobRequestSchema`. */
export const jobDetailsNameFormSchema = (
  t?: IntlTranslation<"Components.Jobs.JobDetails.Header.JobName.Schema">,
) =>
  z.object({
    name: z
      .string({ error: t?.("Name.invalid") })
      .min(2, { error: t?.("Name.min") })
      .or(z.literal("")),
  });

export type JobDetailsNameFormSchemaType = z.infer<
  ReturnType<typeof jobDetailsNameFormSchema>
>;

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

export const provideJobInputSchema = z.object({
  jobId: z.string(),
  eventId: z.string(),
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
