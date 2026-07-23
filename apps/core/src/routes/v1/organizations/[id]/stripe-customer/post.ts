import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { provisionedStripeCustomerSchema } from "@/schemas/stripe.schema";
import { provisionOrganizationStripeCustomer } from "@/services/stripe-customer-provision.service";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/stripe-customer",
  description:
    "Ensure a Stripe customer exists for an organization. Any member of the organization may call it. Returns the existing customer id when already provisioned, otherwise creates the Stripe customer, persists the id immediately, and returns the new id.",
  tags: ["Organizations"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      provisionedStripeCustomerSchema,
      "The organization's Stripe customer id",
      {
        data: { stripeCustomerId: "cus_123" },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You are not a member of this organization",
    ),
    404: jsonErrorResponse("Not Found - Organization not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const { organization } = await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
    });

    if (organization.stripeCustomerId) {
      return ok(
        c,
        provisionedStripeCustomerSchema.parse({
          stripeCustomerId: organization.stripeCustomerId,
        }),
      );
    }

    const stripeCustomerId = await provisionOrganizationStripeCustomer({
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
    });

    return ok(c, provisionedStripeCustomerSchema.parse({ stripeCustomerId }));
  });
}
