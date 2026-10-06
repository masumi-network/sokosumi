import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { deletePersonalWorkspace } from "@/helpers/personal-workspace";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { personalWorkspaceDeletedSchema } from "@/schemas/personal-workspace.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "delete",
  path: "/personal-workspace",
  deprecated: true,
  description:
    "Deprecated: use `DELETE /users/{id}/workspaces/{workspaceId}` with the personal workspace's id (ADR 0051). Delete the user's personal workspace (path `me` for the session user, or a user id the caller may access). Refused when it is the user's last workspace. Organization membership must remain.",
  tags: ["Users"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      personalWorkspaceDeletedSchema,
      "Personal workspace deleted",
      {
        data: {
          workspaceId: "11111111-1111-7111-8111-111111111111",
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found - Personal workspace is missing"),
    409: jsonErrorResponse(
      "Conflict - Last workspace, or dependents prevent delete",
    ),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const workspace = await deletePersonalWorkspace(resolvedUserId);

    return ok(
      c,
      personalWorkspaceDeletedSchema.parse({ workspaceId: workspace.id }),
    );
  });
}
