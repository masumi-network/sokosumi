import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { subscriptionCatalogSchema } from "@/schemas/billing.schema";
import { stripeBillingService } from "@/services/stripe-billing.service";

const route = createRoute({
  method: "get",
  path: "/subscription",
  operationId: "getSubscriptionCatalog",
  description:
    "Self-serve subscription catalog (free, starter, standard, pro) resolved from Stripe product metadata.",
  tags: ["Products"],
  responses: {
    200: jsonSuccessResponse(
      subscriptionCatalogSchema,
      "Subscription catalog for billing and onboarding UI",
      {
        data: {
          free: {
            credits: 60,
            currency: "eur",
            monthlyAmount: 0,
            name: "free",
            priceId: "",
            productId: "local-free",
            slug: "free",
          },
          starter: {
            credits: 100,
            currency: "eur",
            monthlyAmount: 2900,
            name: "starter",
            priceId: "price_starter",
            productId: "prod_starter",
            slug: "starter",
          },
          standard: {
            credits: 500,
            currency: "eur",
            monthlyAmount: 9900,
            name: "standard",
            priceId: "price_standard",
            productId: "prod_standard",
            slug: "standard",
          },
          pro: {
            credits: 2000,
            currency: "eur",
            monthlyAmount: 29900,
            name: "pro",
            priceId: "price_pro",
            productId: "prod_pro",
            slug: "pro",
          },
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireUserContext(c.var.authContext);

    const catalog = await stripeBillingService.getSubscriptionCatalog();

    return ok(c, subscriptionCatalogSchema.parse(catalog));
  });
}
