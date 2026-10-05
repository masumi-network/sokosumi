import { createRoute, z } from "@hono/zod-openapi";
import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import { resolveTaskRefToId } from "@/helpers/task-ref";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { isCoworkerAuthContext, isUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { taskSchema } from "@/schemas/task.schema";
import { buildTaskIncludeForViewer } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description:
      "Task id, or a project identifier such as SOK-123 (case-insensitive, resolved in the active workspace, including a prefix the project has since changed; a trailing slug like SOK-123-fix-login is ignored).",
    example: "SOK-123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}",
  description:
    "Retrieve task details by task id or by project identifier such as SOK-123. A former identifier still resolves after the task moves projects or the project prefix changes.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(taskSchema, "Retrieve task"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const { authContext, workspaceContext } = c.var;

    const workspaceId =
      isUserAuthContext(authContext) ||
      (isCoworkerAuthContext(authContext) && authContext.context)
        ? requireWorkspaceContext(workspaceContext).workspaceId
        : null;

    const include = buildTaskIncludeForViewer(authContext, workspaceId);
    const taskId = workspaceId
      ? await resolveTaskRefToId(id, workspaceId, prisma)
      : id;
    const task = await requireTaskReadForRouteVars(
      c.var,
      taskId,
      prisma,
      include,
    );

    return ok(c, taskSchema.parse(mapTask(task, authContext)));
  });
}
