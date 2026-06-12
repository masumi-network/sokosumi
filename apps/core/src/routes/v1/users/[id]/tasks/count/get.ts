import { createRoute, z } from "@hono/zod-openapi";
import { Prisma } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { isCoworkerAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { usersRoutePathUserIdSchema } from "@/routes/v1/users/user-path-access";
import {
  requireUserRouteContext,
  type UserRouteVariables,
} from "@/routes/v1/users/user-route-context";
import { taskCountSchema } from "@/schemas/task.schema";

const params = z.object({
  id: usersRoutePathUserIdSchema,
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/tasks/count",
    description:
      "Get task count for the user. Returns the number of non-archived tasks in the active workspace owned by the user. Use path `me` for the session user, or a user id when authorized.",
    tags: ["Tasks", "Users"],
    request: {
      params,
    },
    responses: {
      200: jsonSuccessResponse(
        taskCountSchema,
        "Retrieve the user's task count",
        {
          data: {
            count: 42,
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
  }),
);

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    c.req.valid("param");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    // Build where clause matching task list filters
    let where: Prisma.TaskWhereInput;
    if (isCoworkerAuthContext(authContext)) {
      if (authContext.delegation) {
        const workspaceContext = requireWorkspaceContext(
          c.var.workspaceContext,
        );
        where = {
          archivedAt: null,
          workspaceId: workspaceContext.workspaceId,
          userId: resolvedUserId,
        };
      } else {
        // Non-delegated coworkers: count their assigned tasks, exclude DRAFT
        where = {
          coworkerId: authContext.coworkerId,
          archivedAt: null,
          NOT: { status: { in: [TaskStatus.DRAFT] } },
        };
      }
    } else {
      const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);
      where = {
        archivedAt: null,
        workspaceId: workspaceContext.workspaceId,
        userId: resolvedUserId,
      };
    }

    const count = await prisma.task.count({ where });

    return ok(c, taskCountSchema.parse({ count }));
  });
}
