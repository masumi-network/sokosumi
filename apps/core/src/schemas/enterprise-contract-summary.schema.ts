import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime.js";

export const enterpriseContractBillingSummarySchema = z
  .object({
    activatedAt: dateTimeSchema,
    endsAt: dateTimeSchema,
    currentPeriodEnd: dateTimeSchema.nullable(),
    isConsumable: z.boolean(),
    monthlyCredits: z.number().nullable(),
    nextActivationAt: dateTimeSchema.nullable(),
    poolRemainingCredits: z.number(),
    purchasedSeats: z.number().int(),
  })
  .openapi("EnterpriseContractBillingSummary");
