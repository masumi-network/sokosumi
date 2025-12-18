import { z } from "zod";

export const provideInputDataSchema = z.record(
  z.string(),
  z.union([
    z.number(),
    z.array(z.number()),
    z.string(),
    z.array(z.string()),
    z.boolean(),
    z.undefined(),
    z.instanceof(File),
    z.array(z.instanceof(File)),
  ]),
);

export type ProvideInputDataSchemaType = z.infer<typeof provideInputDataSchema>;

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
