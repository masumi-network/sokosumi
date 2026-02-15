import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

export const subscriptionSchema = z.object({
  id: z.string().openapi({ example: "sub_123" }),
  plan: z.string().openapi({ example: "starter" }),
  status: z.string().openapi({ example: "active" }),
  periodStart: dateTimeSchema.nullish(),
  periodEnd: dateTimeSchema.nullish(),
  cancelAtPeriodEnd: z.boolean().nullish().openapi({ example: false }),
});

export type Subscription = z.infer<typeof subscriptionSchema>;
