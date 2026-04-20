import { createRoute, z } from "@hono/zod-openapi";
import { parseOrganizationMetadata } from "@sokosumi/utils";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  resolveUsersPathUserId,
  usersRoutePathUserIdSchema,
} from "@/routes/v1/users/user-path-access";
import { organizationsSchema } from "@/schemas/organization.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "get",
  path: "/{id}/organizations",
  description:
    "Get organizations for a user: path `me` for the session user, or a user id when the caller may access that user's data.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      organizationsSchema,
      "Retrieve organizations for the user",
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
    const { id: pathUser } = c.req.valid("param");
    const { targetUserId } = resolveUsersPathUserId(
      c.var.authContext,
      pathUser,
    );

    const organizations = await prisma.$transaction(async (tx) => {
      const members = await tx.member.findMany({
        where: { userId: targetUserId },
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
