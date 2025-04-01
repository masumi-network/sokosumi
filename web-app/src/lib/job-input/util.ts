import { z } from "zod";

export const allowEmptyString = (schema: z.ZodSchema) => {
  return schema.or(z.literal(""));
};
