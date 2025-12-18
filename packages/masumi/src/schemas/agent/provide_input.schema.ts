import { z } from "zod";

import { provideInputDataSchema } from "../input/input.schema.js";

export const provideInputRequestSchema = z.object({
  job_id: z.string(),
  status_id: z.string(),
  input_data: provideInputDataSchema,
});

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
