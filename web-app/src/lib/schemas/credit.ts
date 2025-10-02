import * as z from "zod";

// this isn't for user's use, only for internal use
export const pricingAmountsSchema = z.array(
  z.object({
    unit: z.string(),
    amount: z.coerce.bigint().positive(),
  }),
);

export type PricingAmountsSchemaType = z.infer<typeof pricingAmountsSchema>;
