import { z } from "zod";

export const betterAuthApiErrorSchema = z.object({
  status: z.string(),
  statusCode: z.number(),
  body: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type BetterAuthApiErrorSchemaType = z.infer<
  typeof betterAuthApiErrorSchema
>;
