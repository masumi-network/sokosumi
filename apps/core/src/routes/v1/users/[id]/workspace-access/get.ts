import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { loadWorkspaceAccess } from "@/helpers/workspace-access";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { workspaceAccessSchema } from "@/schemas/workspace-access.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "get",
  path: "/workspace-access",
  description:
    "Current-user workspace access facts: path `me` for the session user, or a user id when the caller may access that user's data. `ready` if personal workspace and/or any organization membership exists; `pending-invites` if neither and they have non-expired pending organization invitations; `identity-onboarding` if neither and no pending org entry.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      workspaceAccessSchema,
      "Retrieve the user's workspace access",
      {
        data: {
          gate: "ready",
          hasPersonalWorkspace: true,
          hasOrganizationMembership: false,
          hasPendingOrganizationInvites: false,
        },
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

    // Read-only GET: default client + concurrent queries (not interactive tx —
    // Promise.all on interactive transaction clients is unsupported; #2559).
    const access = await loadWorkspaceAccess(resolvedUserId, prisma);

    return ok(c, workspaceAccessSchema.parse(access));
  });
}
