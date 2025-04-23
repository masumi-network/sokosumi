import { z } from "zod";

export const pricingAmountsSchema = z.array(
  z.object({
    unit: z.string(),
    amount: z.number().positive(),
  }),
);

export type PricingAmountsSchemaType = z.infer<typeof pricingAmountsSchema>;
