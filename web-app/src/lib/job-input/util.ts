import { z } from "zod";

export const allowEmptyString = (schema: z.ZodSchema<string>) => {
  return schema.or(z.literal(""));
};
