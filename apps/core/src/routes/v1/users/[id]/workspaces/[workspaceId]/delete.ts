import { createRoute, z } from "@hono/zod-openapi";

import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { deletePersonalWorkspace } from "@/helpers/personal-workspace";
import { ok } from "@/helpers/response";
import { getUserWorkspace } from "@/helpers/user-workspaces";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { personalWorkspaceDeletedSchema } from "@/schemas/personal-workspace.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
  workspaceId: z.uuid().openapi({
    description: "Id of the user's personal workspace",
    example: "11111111-1111-7111-8111-111111111111",
  }),
});

const route = createRoute({
  method: "delete",
  path: "/workspaces/{workspaceId}",
  description:
    "Delete the user's personal workspace (path `me` for the session user, or a user id the caller may access). An organization workspace is refused (409): deleting or leaving an organization is not part of this resource. Refused when it is the user's last workspace, or while jobs or tasks still use it. A workspace the user cannot act in is 404. See ADR 0051.",
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
    404: jsonErrorResponse("Not Found - Workspace not found"),
    409: jsonErrorResponse(
      "Conflict - An organization workspace, the last workspace, or dependents prevent delete",
    ),
    422: jsonErrorResponse("Unprocessable Entity - Invalid workspace id"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const { workspaceId } = c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const workspace = await getUserWorkspace(resolvedUserId, {
      id: workspaceId,
    });
    if (workspace.kind !== "personal") {
      throw conflict("Only a personal workspace can be deleted here");
    }

    const deleted = await deletePersonalWorkspace(resolvedUserId);

    return ok(
      c,
      personalWorkspaceDeletedSchema.parse({ workspaceId: deleted.id }),
    );
  });
}
