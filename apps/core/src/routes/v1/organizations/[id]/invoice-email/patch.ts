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
import {
  organizationInvoiceEmailSchema,
  organizationInvoiceEmailWriteSchema,
} from "@/schemas/organization.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "patch",
  path: "/{id}/invoice-email",
  description:
    "Set or clear an organization's invoice email. Only organization owners and admins may do this. Pass a null `invoiceEmail` to clear it.",
  tags: ["Organizations"],
  request: {
    params,
    body: {
      content: {
        "application/json": {
          schema: organizationInvoiceEmailWriteSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      organizationInvoiceEmailSchema,
      "The persisted invoice email for the organization",
      {
        data: {
          invoiceEmail: "billing@acme.example",
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
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { invoiceEmail } = c.req.valid("json");

    const { organization } = await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });

    const updatedOrganization =
      await organizationRepository.updateOrganizationInvoiceEmail(
        organization.id,
        invoiceEmail,
        prisma,
      );

    return ok(
      c,
      organizationInvoiceEmailSchema.parse({
        invoiceEmail: getOrganizationMetadata(updatedOrganization.metadata)
          .invoiceEmail,
      }),
    );
  });
}
