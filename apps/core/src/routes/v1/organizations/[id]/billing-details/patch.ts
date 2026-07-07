import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import {
  stripeCustomerBillingDetailsSchema,
  stripeCustomerBillingDetailsWriteSchema,
} from "@/schemas/stripe.schema";
import { stripeCustomerBillingService } from "@/services/stripe-customer-billing.service";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "patch",
  path: "/{id}/billing-details",
  description:
    "Update billing address and optional tax ID on the organization's Stripe customer. Only organization owners and admins may do this. Creates a Stripe customer when none exists yet.",
  tags: ["Organizations"],
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
          stripeCustomerId: "cus_org_123",
          address: {
            line1: "456 Market St",
            line2: null,
            city: "San Francisco",
            state: "CA",
            postalCode: "94105",
            country: "US",
          },
          taxIds: [],
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You must be an organization owner or admin",
    ),
    404: jsonErrorResponse("Not Found - Organization not found"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const payload = c.req.valid("json");

    const billingDetails =
      await stripeCustomerBillingService.updateOrganizationBillingDetails(
        id,
        userContext.userId,
        payload,
      );

    return ok(c, stripeCustomerBillingDetailsSchema.parse(billingDetails));
  });
}
