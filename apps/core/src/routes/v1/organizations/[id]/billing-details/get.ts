import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { hasAdminRole, requireUserContext } from "@/middleware/auth";
import { stripeCustomerBillingDetailsSchema } from "@/schemas/stripe.schema";
import { stripeCustomerBillingService } from "@/services/stripe-customer-billing.service";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/billing-details",
  description:
    "Get billing address and tax IDs stored on the organization's Stripe customer. Organization owners and admins only.",
  tags: ["Organizations"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      stripeCustomerBillingDetailsSchema,
      "The organization's Stripe billing details",
      {
        data: {
          stripeCustomerId: "cus_org_123",
          email: "billing@acme.example",
          address: null,
          taxIds: [],
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You are not an owner or admin of this organization",
    ),
    404: jsonErrorResponse("Not Found - Organization not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const isPlatformAdmin =
      userContext.source === "session" && hasAdminRole(userContext.role);

    const billingDetails = isPlatformAdmin
      ? await stripeCustomerBillingService.getOrganizationBillingDetailsById(id)
      : await stripeCustomerBillingService.getOrganizationBillingDetails(
          id,
          userContext.userId,
        );

    return ok(c, stripeCustomerBillingDetailsSchema.parse(billingDetails));
  });
}
