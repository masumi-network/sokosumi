import { z } from "zod";

import {
  provideInputDataSchema,
  provideInputGroupsSchema,
} from "./input.schema.js";

export const provideInputRequestSchema = z
  .object({
    job_id: z.string(),
    status_id: z.string(),
    provideInputDataSchema,
    provideInputGroupsSchema,
  })
  .refine(
    (data) => {
      const hasInputData = "input_data" in data;
      const hasInputGroups = "input_groups" in data;
      return hasInputData !== hasInputGroups; // Exactly one must be present
    },
    {
      message: "Must provide exactly one of 'input_data' or 'input_groups'",
    },
  );

export type ProvideInputRequestSchemaType = z.infer<
  typeof provideInputRequestSchema
>;

export const provideInputResponseSchema = z.object({
  input_hash: z.string(),
  signature: z.string(),
});

export type ProvideInputResponseSchemaType = z.infer<
  typeof provideInputResponseSchema
>;
