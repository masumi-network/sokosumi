import { createRoute, z } from "@hono/zod-openapi";
import { invitationRepository } from "@sokosumi/database/repositories";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { userPendingInvitationsSchema } from "@/schemas/invitation.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "get",
  path: "/invitations/pending",
  description:
    "List valid pending invitations for the session user's email address.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      userPendingInvitationsSchema,
      "Retrieve valid pending invitations for the current user",
      {
        data: [
          {
            id: "inv_123",
            organizationId: "org_123",
            email: "jane@example.com",
            role: "member",
            status: "pending",
            expiresAt: "2026-12-31T23:59:59.000Z",
            inviterId: "user_123",
            createdAt: "2026-01-01T00:00:00.000Z",
            organization: {
              id: "org_123",
              name: "Acme Inc",
              slug: "acme-inc",
            },
            inviter: {
              id: "user_123",
              email: "owner@example.com",
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

    const invitations = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: resolvedUserId },
        select: { email: true },
      });

      if (!user?.email) {
        return [];
      }

      return invitationRepository.getValidPendingInvitationsByEmail(
        user.email,
        tx,
      );
    });

    return ok(c, userPendingInvitationsSchema.parse(invitations));
  });
}
