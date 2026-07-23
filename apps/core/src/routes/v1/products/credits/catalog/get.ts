import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { creditTopUpPricingSchema } from "@/schemas/billing.schema";
import { stripeBillingService } from "@/services/stripe-billing.service";

const route = createRoute({
  method: "get",
  path: "/credits/catalog",
  operationId: "getCreditTopUpPriceCatalog",
  description:
    "Account-resolved credit top-up pricing for the authenticated user. Pricing tiers and zero-margin eligibility are determined server-side; no request input influences pricing.",
  tags: ["Products"],
  responses: {
    200: jsonSuccessResponse(
      creditTopUpPricingSchema,
      "Account-resolved credit top-up pricing",
      {
        data: {
          currency: "eur",
          tiers: [
            { minCredits: 1, amountPerCredit: 120 },
            { minCredits: 10000, amountPerCredit: 115 },
            { minCredits: 100000, amountPerCredit: 110 },
          ],
          referenceAmountPerCredit: 120,
          canPurchaseOnFreePlan: false,
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
    const userContext = requireUserAuthContext(c.var.authContext);

    const pricing = await stripeBillingService.getCreditTopUpPricing(
      userContext.userId,
    );

    return ok(c, creditTopUpPricingSchema.parse(pricing));
  });
}
