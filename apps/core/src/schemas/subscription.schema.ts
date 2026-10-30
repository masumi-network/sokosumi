import { z } from "@hono/zod-openapi";

import { dateTimeSchema } from "@/helpers/datetime";
import { stripeSubscriptionStatusSchema } from "@/schemas/domain-enums.schema";

export const subscriptionSchema = z.object({
  plan: z.string().openapi({ example: "starter" }),
  status: stripeSubscriptionStatusSchema,
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
        status: stripeSubscriptionStatusSchema,
        cancelAtPeriodEnd: z.boolean().nullish().openapi({ example: false }),
        cancelAt: dateTimeSchema.nullish().openapi({
          description:
            "When a scheduled cancellation takes effect. Stripe flexible billing mode sets this instead of cancelAtPeriodEnd",
        }),
        periodStart: dateTimeSchema.nullish(),
        periodEnd: dateTimeSchema.nullish(),
        seats: z.number().int().nullish().openapi({ example: 3 }),
      })
      .nullable(),
  })
  .openapi("ActiveSubscriptionResponse");

/** Request body for immediately updating an organization's purchased seats. */
export const updateOrganizationSubscriptionSeatsSchema = z
  .object({
    seats: z.number().int().min(1).openapi({
      description: "Desired purchased seat count",
      example: 3,
    }),
  })
  .openapi("UpdateOrganizationSubscriptionSeats");

/** Purchased seat count after an organization seat update. */
export const organizationSubscriptionSeatsSchema = z
  .object({
    seats: z.number().int().openapi({
      description: "Purchased seat count on the active subscription",
      example: 3,
    }),
  })
  .openapi("OrganizationSubscriptionSeats");

export const organizationSubscriptionSeatsPreviewQuerySchema = z.object({
  seats: z.coerce
    .number()
    .int()
    .min(1)
    .openapi({
      param: { name: "seats", in: "query" },
      description: "Desired purchased seat count",
      example: 5,
    }),
});

/** What a seat change would cost. Amounts are in the currency's minor units. */
export const organizationSubscriptionSeatsPreviewSchema = z
  .object({
    amountDue: z.number().int().openapi({
      description: "Charged to the payment method right away, including tax",
      example: 1234,
    }),
    creditAmount: z.number().int().openapi({
      description:
        "Unused amount added to the Stripe customer balance when seats are removed",
      example: 0,
    }),
    currency: z.string().openapi({
      description: "Lowercase ISO currency code",
      example: "eur",
    }),
    newMonthlyAmount: z.number().int().openapi({
      description:
        "Monthly price for the new seat count, before tax and discounts",
      example: 12500,
    }),
    seats: z.number().int().openapi({
      description: "The seat count this preview is for",
      example: 5,
    }),
  })
  .openapi("OrganizationSubscriptionSeatsPreview");
