import { z } from "@hono/zod-openapi";

const subscriptionCatalogPlanSchema = z
  .object({
    credits: z.number().openapi({ example: 100 }),
    currency: z.string().openapi({ example: "eur" }),
    monthlyAmount: z.number().openapi({ example: 2900 }),
    name: z
      .enum(["free", "starter", "standard", "pro"])
      .openapi({ example: "starter" }),
    priceId: z.string().openapi({ example: "price_123" }),
    productId: z.string().openapi({ example: "prod_123" }),
    slug: z.string().openapi({ example: "starter" }),
  })
  .openapi("SubscriptionCatalogPlan");

export const subscriptionCatalogSchema = z
  .object({
    free: subscriptionCatalogPlanSchema,
    starter: subscriptionCatalogPlanSchema,
    standard: subscriptionCatalogPlanSchema,
    pro: subscriptionCatalogPlanSchema,
  })
  .openapi("SubscriptionCatalog");
