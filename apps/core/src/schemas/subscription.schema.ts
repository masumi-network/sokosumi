import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

export const subscriptionSchema = z.object({
  id: z.string().openapi({ example: "sub_123" }),
  plan: z.string().openapi({ example: "starter" }),
  status: z.string().openapi({ example: "active" }),
  periodStart: dateTimeSchema.nullish(),
  periodEnd: dateTimeSchema.nullish(),
  cancelAtPeriodEnd: z.boolean().nullish().openapi({ example: false }),
  credits: z
    .object({
      total: z.number().openapi({
        description: "Total subscription-period credits granted this period",
        example: 100,
      }),
      remaining: z.number().openapi({
        description: "Remaining subscription-period credits this period",
        example: 57.5,
      }),
      used: z.number().openapi({
        description:
          "Used subscription-period credits consumed during this period",
        example: 42.5,
      }),
    })
    .nullable(),
});

export type Subscription = z.infer<typeof subscriptionSchema>;
