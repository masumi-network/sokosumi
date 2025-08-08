import { z } from "zod";

export const pricingAmountsSchema = z.array(
  z.object({
    unit: z.string(),
    amount: z.coerce.number().int().positive(),
  }),
);

export type PricingAmountsSchemaType = z.infer<typeof pricingAmountsSchema>;

// Backwards-compatible alias
export const creditSchema = pricingAmountsSchema;
export type CreditSchema = PricingAmountsSchemaType;
