import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { createPersonalWorkspace } from "@/helpers/personal-workspace";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { personalWorkspaceCreatedSchema } from "@/schemas/personal-workspace.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = createRoute({
  method: "post",
  path: "/personal-workspace",
  deprecated: true,
  description:
    'Deprecated: use `POST /users/{id}/workspaces` with `{ kind: "personal" }` (ADR 0051). Create exactly one personal workspace for the user (path `me` for the session user, or a user id the caller may access). Clears preferredOrganizationId so personal context is ready for activation. Conflicts if a personal workspace already exists.',
  tags: ["Users"],
  request: { params },
  responses: {
    201: jsonSuccessResponse(
      personalWorkspaceCreatedSchema,
      "Personal workspace created",
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
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict - Personal workspace already exists"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    const workspace = await createPersonalWorkspace(resolvedUserId);

    return created(
      c,
      personalWorkspaceCreatedSchema.parse({ workspaceId: workspace.id }),
    );
  });
}
