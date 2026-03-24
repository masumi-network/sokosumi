import { createRoute } from "@hono/zod-openapi";
import { parseOrganizationMetadata } from "@sokosumi/utils";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { organizationsSchema } from "@/schemas/organization.schema";

const route = createRoute({
  method: "get",
  path: "/organizations",
  description: "Get all organizations for the current user",
  tags: ["Users"],
  responses: {
    200: jsonSuccessResponse(
      organizationsSchema,
      "Retrieve organizations for current user",
      {
        data: [
          {
            id: "org_123",
            name: "My Organization",
            slug: "my-org",
            logo: "https://example.com/logo.png",
            metadata: {
              url: "https://example.com",
              invoiceEmail: "test@example.com",
            },
            createdAt: "2025-01-01T00:00:00.000Z",
            role: "member",
          },
        ],
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);

    const organizations = await prisma.$transaction(async (tx) => {
      const members = await tx.member.findMany({
        where: { userId: authContext.userId },
        include: { organization: true },
      });

      if (members.length === 0) {
        return [];
      }

      return members.map((member) => ({
        ...member.organization,
        metadata: parseOrganizationMetadata(member.organization.metadata),
        role: member.role,
      }));
    });
    return ok(c, organizationsSchema.parse(organizations));
  });
}
