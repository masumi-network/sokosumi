import { z } from "zod";

// there aren't for user's use, only for internal use
export const pricingAmountsSchema = z.array(
  z.object({
    unit: z.string(),
    amount: z.number().positive(),
  }),
);

export type PricingAmountsSchemaType = z.infer<typeof pricingAmountsSchema>;
