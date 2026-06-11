import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";

export const subscriptionSchema = z.object({
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

/**
 * Active subscription resolved for a billing reference (a user or an
 * organization). `subscription` is `null` when the reference has no active
 * subscription — callers typically fall back to the free plan.
 */
export const activeSubscriptionResponseSchema = z
  .object({
    subscription: z
      .object({
        plan: z.string().openapi({ example: "starter" }),
        status: z.string().openapi({ example: "active" }),
        cancelAtPeriodEnd: z.boolean().nullish().openapi({ example: false }),
        periodStart: dateTimeSchema.nullish(),
        periodEnd: dateTimeSchema.nullish(),
        seats: z.number().int().nullish().openapi({ example: 3 }),
      })
      .nullable(),
  })
  .openapi("ActiveSubscriptionResponse");

export type ActiveSubscriptionResponse = z.infer<
  typeof activeSubscriptionResponseSchema
>;
