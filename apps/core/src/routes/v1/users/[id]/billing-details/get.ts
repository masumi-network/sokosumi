import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { stripeCustomerBillingDetailsSchema } from "@/schemas/stripe.schema";
import { stripeCustomerBillingService } from "@/services/stripe-customer-billing.service";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/billing-details",
    description:
      "Get billing address and tax IDs stored on the user's Stripe customer (path `me` for the session user). `stripeCustomerId` is null when no Stripe customer has been provisioned yet.",
    tags: ["Users"],
    request: {
      params,
    },
    responses: {
      200: jsonSuccessResponse(
        stripeCustomerBillingDetailsSchema,
        "The user's Stripe billing details",
        {
          data: {
            stripeCustomerId: "cus_123",
            email: "billing@example.com",
            address: {
              line1: "123 Main St",
              line2: null,
              city: "Berlin",
              state: null,
              postalCode: "10115",
              country: "DE",
            },
            taxIds: [
              {
                id: "txi_123",
                type: "eu_vat",
                value: "DE123456789",
                country: "DE",
                verificationStatus: "verified",
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
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found - User not found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const billingDetails =
      await stripeCustomerBillingService.getUserBillingDetails(resolvedUserId);

    return ok(c, stripeCustomerBillingDetailsSchema.parse(billingDetails));
  });
}
