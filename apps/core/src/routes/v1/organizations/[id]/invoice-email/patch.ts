import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { organizationRepository } from "@sokosumi/database/repositories";
import { getOrganizationMetadata } from "@sokosumi/utils";

import { stripeClient } from "@/clients/stripe.client";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const requestBodySchema = z.object({
  invoiceEmail: z.email().nullable().openapi({
    description: "Invoice email for the organization, or null to clear",
    example: "billing@example.com",
  }),
});

const responseSchema = z.object({
  invoiceEmail: z.string().nullable(),
});

const route = createRoute({
  method: "patch",
  path: "/{id}/invoice-email",
  description:
    "Update the organization's invoice email (owner/admin only) and sync Stripe when configured.",
  tags: ["Organizations"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: requestBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      responseSchema,
      "Updated organization invoice email",
      {
        data: {
          invoiceEmail: "billing@example.com",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { invoiceEmail } = c.req.valid("json");

    const result = await prisma.$transaction(async (tx) => {
      await resolveMemberOrganizationById({
        id,
        userId: userContext.userId,
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
        tx,
      });

      const updatedOrganization =
        await organizationRepository.updateOrganizationInvoiceEmail(
          id,
          invoiceEmail,
          tx,
        );

      if (updatedOrganization.stripeCustomerId) {
        await stripeClient.updateCustomerEmail(
          updatedOrganization.stripeCustomerId,
          invoiceEmail,
        );
      }

      return {
        invoiceEmail: getOrganizationMetadata(updatedOrganization.metadata)
          .invoiceEmail,
      };
    });

    return ok(c, responseSchema.parse(result));
  });
}
