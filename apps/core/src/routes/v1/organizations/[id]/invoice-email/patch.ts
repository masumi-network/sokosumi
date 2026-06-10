import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { organizationRepository } from "@sokosumi/database/repositories";
import { getOrganizationMetadata } from "@sokosumi/utils";

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

const bodySchema = z.object({
  invoiceEmail: z.email().nullable(),
});

const invoiceEmailResponseSchema = z
  .object({
    invoiceEmail: z.string().nullable(),
  })
  .openapi("OrganizationInvoiceEmail");

const route = createRoute({
  method: "patch",
  path: "/{id}/invoice-email",
  description:
    "Update the organization's invoice email stored in metadata. Requires owner or admin role.",
  tags: ["Organizations"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: bodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      invoiceEmailResponseSchema,
      "Updated organization invoice email",
      {
        data: { invoiceEmail: "billing@example.com" },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - Organization not found"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { invoiceEmail } = c.req.valid("json");

    const updatedOrganization = await prisma.$transaction(async (tx) => {
      await resolveMemberOrganizationById({
        id,
        userId: userContext.userId,
        allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
        tx,
      });

      return await organizationRepository.updateOrganizationInvoiceEmail(
        id,
        invoiceEmail,
        tx,
      );
    });

    return ok(
      c,
      invoiceEmailResponseSchema.parse({
        invoiceEmail: getOrganizationMetadata(updatedOrganization.metadata)
          .invoiceEmail,
      }),
    );
  });
}
