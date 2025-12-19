import * as z from "zod";

import { inputSchemaSchema } from "../input/input.schema.js";

// Agent job status values - single source of truth
export const JOB_STATUS = [
  "awaiting_payment",
  "awaiting_input",
  "running",
  "completed",
  "failed",
] as const;

export type JobStatus = (typeof JOB_STATUS)[number];

export const jobStatusResponseSchema = z
  .object({
    id: z.string().nullish(),
    status: z.enum(JOB_STATUS),
    input_schema: inputSchemaSchema.nullish(),
    result: z.string().nullish(),
  })
  .superRefine((data, ctx) => {
    requireFieldWhenStatus("awaiting_input", "input_schema")(data, ctx);
    requireFieldWhenStatus("completed", "result")(data, ctx);
  });

export type JobStatusResponseSchemaType = z.infer<
  typeof jobStatusResponseSchema
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
