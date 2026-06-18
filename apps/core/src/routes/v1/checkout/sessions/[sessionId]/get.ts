import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { checkoutSessionAnalyticsSchema } from "@/schemas/billing.schema";
import { stripeBillingService } from "@/services/stripe-billing.service";

const params = z.object({
  sessionId: z.string().openapi({
    param: { name: "sessionId", in: "path" },
    description: "Stripe Checkout session id",
    example: "cs_test_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/sessions/{sessionId}",
  operationId: "getCheckoutSessionAnalytics",
  description:
    "Retrieve analytics-friendly checkout session data after returning from Stripe Checkout.",
  tags: ["Checkout"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      checkoutSessionAnalyticsSchema,
      "Checkout session analytics payload",
      {
        data: {
          sessionId: "cs_test_123",
          currency: "eur",
          value: 12000,
          items: [
            {
              itemId: "prod_123",
              itemName: "Credits",
              quantity: 1,
            },
          ],
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { sessionId } = c.req.valid("param");

    const analytics = await stripeBillingService.getCheckoutSessionAnalytics(
      sessionId,
      userContext.userId,
    );

    return ok(c, checkoutSessionAnalyticsSchema.parse(analytics));
  });
}
