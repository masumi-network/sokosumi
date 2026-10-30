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

/** Request body for changing an organization's purchased seats. */
export const updateOrganizationSubscriptionSeatsSchema = z
  .object({
    seats: z.number().int().min(1).openapi({
      description: "Desired purchased seat count",
      example: 3,
    }),
  })
  .openapi("UpdateOrganizationSubscriptionSeats");

/** Purchased seats now, and the reduction waiting for the next renewal. */
export const organizationSubscriptionSeatsSchema = z
  .object({
    seats: z.number().int().openapi({
      description: "Purchased seat count on the active subscription",
      example: 3,
    }),
    scheduledReduction: z
      .object({
        effectiveAt: dateTimeSchema.openapi({
          description: "When the reduction takes effect: the next renewal",
          example: "2025-02-01T00:00:00.000Z",
        }),
        seats: z.number().int().openapi({
          description: "Seat count the subscription drops to",
          example: 2,
        }),
      })
      .nullable()
      .openapi({ description: "Null when no reduction is pending" }),
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
      description:
        "Charged to the payment method right away, including tax. Zero unless seats are added",
      example: 1234,
    }),
    currency: z.string().openapi({
      description: "Lowercase ISO currency code",
      example: "eur",
    }),
    effectiveAt: dateTimeSchema.nullable().openapi({
      description:
        "When a reduction takes effect: the next renewal. Null when the change applies right away",
      example: null,
    }),
    newMonthlyAmount: z.number().int().openapi({
      description:
        "Next regular invoice at the new seat count, including tax and discounts",
      example: 14875,
    }),
    seats: z.number().int().openapi({
      description: "The seat count this preview is for",
      example: 5,
    }),
  })
  .openapi("OrganizationSubscriptionSeatsPreview");
