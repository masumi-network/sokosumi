import { createRoute, z } from "@hono/zod-openapi";

import { listPendingOrganizationInvitationsForUser } from "@/helpers/invitation";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { userPendingOrganizationInvitationsSchema } from "@/schemas/invitation.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "get",
  path: "/pending-organization-invitations",
  description:
    "List non-expired pending organization invitations for the target user, matched by email. Path `me` for the session user, or a user id when the caller may access that user's data. Chat-room guest invitations are not included.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      userPendingOrganizationInvitationsSchema,
      "List pending organization invitations for the user",
      {
        data: [
          {
            id: "inv_123",
            organizationId: "org_123",
            email: "jane@example.com",
            role: "member",
            status: "pending",
            expiresAt: "2025-06-08T14:30:00.000Z",
            createdAt: "2025-01-01T00:00:00.000Z",
            organization: {
              id: "org_123",
              name: "Acme Inc",
              slug: "acme-inc",
              logo: null,
            },
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
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const invitations = await listPendingOrganizationInvitationsForUser(
      resolvedUserId,
      prisma,
    );

    c.header("Cache-Control", "no-store");
    return ok(c, userPendingOrganizationInvitationsSchema.parse(invitations));
  });
}
