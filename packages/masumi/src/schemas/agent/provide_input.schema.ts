import { z } from "zod";

import { inputSchema } from "../input/input.schema.js";

export const provideInputRequestSchema = z.object({
  job_id: z.string(),
  status_id: z.string(),
  input_data: inputSchema,
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
