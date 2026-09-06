import { createRoute, z } from "@hono/zod-openapi";
import { parseOrganizationMetadata } from "@sokosumi/utils";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { organizationsSchema } from "@/schemas/organization.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/organizations",
    description:
      "Get organizations for a user: path `me` for the session user, or a user id when the caller may access that user's data. Session user or coworker with matching authorized `X-Context-User-Id`.",
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
      404: jsonErrorResponse("Not Found"),
      500: jsonErrorResponse("Internal Server Error"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const members = await prisma.member.findMany({
      where: { userId: resolvedUserId },
      include: { organization: true },
    });

    const organizations =
      members.length === 0
        ? []
        : members.map((member) => ({
            ...member.organization,
            metadata: parseOrganizationMetadata(member.organization.metadata),
            role: member.role,
          }));
    return ok(c, organizationsSchema.parse(organizations));
  });
}
