import { createRoute, z } from "@hono/zod-openapi";
import { getOrganizationMetadata } from "@sokosumi/utils";

import { stripeClient } from "@/clients/stripe.client";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { provisionedStripeCustomerSchema } from "@/schemas/stripe.schema";

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
    "Ensure a Stripe customer exists for an organization. Any member of the organization may call it. Returns the existing customer id when already provisioned, otherwise creates the Stripe customer and returns the new id. Local persistence of the id happens asynchronously via the Stripe `customer.created` webhook.",
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
    const userContext = requireUserContext(c.var.authContext);
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

    const { invoiceEmail } = getOrganizationMetadata(organization.metadata);
    const customer = await stripeClient.createOrganizationCustomer({
      invoiceEmail,
      name: organization.name,
      organizationId: organization.id,
      slug: organization.slug,
    });

    return ok(
      c,
      provisionedStripeCustomerSchema.parse({ stripeCustomerId: customer.id }),
    );
  });
}
