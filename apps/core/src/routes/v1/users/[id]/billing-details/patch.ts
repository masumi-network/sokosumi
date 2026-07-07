import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import {
  stripeCustomerBillingDetailsSchema,
  stripeCustomerBillingDetailsWriteSchema,
} from "@/schemas/stripe.schema";
import { stripeCustomerBillingService } from "@/services/stripe-customer-billing.service";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "patch",
    path: "/billing-details",
    description:
      "Update billing address and optional tax ID on the user's Stripe customer (path `me` for the session user). Creates a Stripe customer when none exists yet.",
    tags: ["Users"],
    request: {
      params,
      body: {
        content: {
          "application/json": {
            schema: stripeCustomerBillingDetailsWriteSchema,
          },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(
        stripeCustomerBillingDetailsSchema,
        "The updated Stripe billing details",
        {
          data: {
            stripeCustomerId: "cus_123",
            address: {
              line1: "123 Main St",
              line2: null,
              city: "Berlin",
              state: null,
              postalCode: "10115",
              country: "DE",
            },
            taxIds: [],
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
      422: jsonErrorResponse("Unprocessable Entity"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);
    const payload = c.req.valid("json");

    const billingDetails =
      await stripeCustomerBillingService.updateUserBillingDetails(
        resolvedUserId,
        payload,
      );

    return ok(c, stripeCustomerBillingDetailsSchema.parse(billingDetails));
  });
}
