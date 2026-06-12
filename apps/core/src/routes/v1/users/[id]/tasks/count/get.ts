import { createRoute, z } from "@hono/zod-openapi";
import { Prisma } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";

import { requireCoworkerCapability } from "@/helpers/access-control";
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

const taskCountScopeQuerySchema = z
  .enum(["workspace", "all"])
  .default("workspace")
  .openapi({
    param: { name: "scope", in: "query" },
    description:
      "Count scope. Defaults to 'workspace' (active workspace only). Use 'all' to count non-archived tasks owned by the user across every workspace.",
    example: "workspace",
  });

const query = z.object({
  scope: taskCountScopeQuerySchema,
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/count",
    description:
      "Get task count for the user. Defaults to non-archived tasks owned by the user in the active workspace (`scope=workspace`). Use `scope=all` to count across every workspace. Use path `me` for the session user, or a user id when authorized.",
    tags: ["Tasks", "Users"],
    request: {
      params,
      query,
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

function buildUserOwnedTaskCountWhere(
  resolvedUserId: string,
  scope: "workspace" | "all",
  workspaceId: string | undefined,
): Prisma.TaskWhereInput {
  return {
    archivedAt: null,
    userId: resolvedUserId,
    ...(scope === "workspace" && workspaceId ? { workspaceId } : {}),
  };
}

export default function mount(app: OpenAPIHonoWithAuth<UserRouteVariables>) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    c.req.valid("param");
    const { scope } = c.req.valid("query");
    const { resolvedUserId } = requireUserRouteContext(c.var.userRouteContext);

    let where: Prisma.TaskWhereInput;
    if (isCoworkerAuthContext(authContext)) {
      await requireCoworkerCapability(authContext.coworkerId, "tasks");

      if (authContext.delegation) {
        const workspaceId =
          scope === "workspace"
            ? requireWorkspaceContext(c.var.workspaceContext).workspaceId
            : undefined;
        where = buildUserOwnedTaskCountWhere(
          resolvedUserId,
          scope,
          workspaceId,
        );
      } else {
        // Non-delegated coworkers: count their assigned tasks, exclude DRAFT
        where = {
          coworkerId: authContext.coworkerId,
          archivedAt: null,
          NOT: { status: { in: [TaskStatus.DRAFT] } },
        };
      }
    } else {
      const workspaceId =
        scope === "workspace"
          ? requireWorkspaceContext(c.var.workspaceContext).workspaceId
          : undefined;
      where = buildUserOwnedTaskCountWhere(resolvedUserId, scope, workspaceId);
    }

    const count = await prisma.task.count({ where });

    return ok(c, taskCountSchema.parse({ count }));
  });
}
