import { z } from "@hono/zod-openapi";
import {
  CREDIT_TOPUP_LOOKUP_KEYS,
  type CreditTopUpLookupKey,
  ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY,
} from "@sokosumi/utils";

import { subscriptionCatalogSchema } from "@/schemas/subscription-catalog.schema";

export const creditTopUpLookupKeySchema = z
  .enum([...CREDIT_TOPUP_LOOKUP_KEYS, ZERO_MARGIN_CREDIT_TOPUP_LOOKUP_KEY] as [
    CreditTopUpLookupKey,
    ...CreditTopUpLookupKey[],
  ])
  .openapi({ example: "credit_20_margin" });

export const creditTopUpPriceSchema = z
  .object({
    id: z.string().openapi({ example: "price_123" }),
    amountPerCredit: z.number().openapi({ example: 120 }),
    currency: z.string().openapi({ example: "eur" }),
  })
  .openapi("CreditTopUpPrice");

export type CreditTopUpPrice = z.infer<typeof creditTopUpPriceSchema>;

export const creditTopUpPriceCatalogSchema = z
  .record(creditTopUpLookupKeySchema, creditTopUpPriceSchema)
  .openapi("CreditTopUpPriceCatalog");

export const creditTopUpCatalogQuerySchema = z
  .object({
    extraLookupKeys: z.string().optional().openapi({
      example: "credit_0_margin",
      description:
        "Comma-separated additional Stripe lookup keys to include in the catalog.",
    }),
  })
  .openapi("CreditTopUpCatalogQuery");

export const createCreditCheckoutSessionSchema = z
  .object({
    organizationId: z
      .string()
      .nullable()
      .optional()
      .openapi({ example: "org_123" }),
    credits: z.number().int().positive().openapi({ example: 1000 }),
    returnPath: z
      .string()
      .optional()
      .openapi({ example: "/billing?tab=credits" }),
    promotionCodeId: z.string().optional().openapi({ example: "promo_123" }),
    priceLookupKeyOverride: creditTopUpLookupKeySchema.optional(),
    origin: z
      .string()
      .url()
      .optional()
      .openapi({ example: "https://app.sokosumi.com" }),
    ttlDays: z.string().optional().openapi({ example: "30" }),
  })
  .openapi("CreateCreditCheckoutSession");

export const creditCheckoutSessionSchema = z
  .object({
    url: z
      .string()
      .url()
      .openapi({ example: "https://checkout.stripe.com/..." }),
  })
  .openapi("CreditCheckoutSession");

export const checkoutSessionAnalyticsSchema = z
  .object({
    sessionId: z.string().openapi({ example: "cs_test_123" }),
    currency: z.string().nullable().openapi({ example: "eur" }),
    value: z.number().nullable().openapi({ example: 12000 }),
    items: z
      .array(
        z.object({
          itemId: z.string().openapi({ example: "prod_123" }),
          itemName: z.string().openapi({ example: "Credits" }),
          quantity: z.number().nullable().openapi({ example: 1 }),
        }),
      )
      .openapi({ example: [] }),
  })
  .openapi("CheckoutSessionAnalytics");

export const couponDetailsSchema = z
  .object({
    id: z.string().openapi({ example: "coupon_123" }),
    percentOff: z.number().openapi({ example: 100 }),
    credits: z.number().int().positive().openapi({ example: 100 }),
    ttlDays: z.string().nullable().openapi({ example: "30" }),
  })
  .openapi("CouponDetails");

export const claimCouponSchema = z
  .object({
    organizationId: z
      .string()
      .nullable()
      .optional()
      .openapi({ example: "org_123" }),
  })
  .openapi("ClaimCoupon");

export const claimedPromotionCodeSchema = z
  .object({
    promotionCodeId: z.string().openapi({ example: "promo_123" }),
    active: z.boolean().openapi({ example: true }),
  })
  .openapi("ClaimedPromotionCode");

export { subscriptionCatalogSchema };
