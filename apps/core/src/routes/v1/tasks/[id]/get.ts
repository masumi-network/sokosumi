import { createRoute, z } from "@hono/zod-openapi";
import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { badRequest, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import { resolveTaskRefToId } from "@/helpers/task-ref";
import { buildHumanTaskVisibilityWhere } from "@/helpers/task-visibility";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  isCoworkerAuthContext,
  isUserAuthContext,
  requireUserContext,
} from "@/middleware/auth";
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

const querySchema = z.object({
  archived: z
    .enum(["true", "false"])
    .optional()
    .openapi({
      param: { name: "archived", in: "query" },
      description:
        "true reads an archived Task instead, read-only, with the same access as the archived list. People only; coworkers and Soko Bots get 400.",
      example: "true",
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
    query: querySchema,
  },
  responses: {
    200: jsonSuccessResponse(taskSchema, "Retrieve task"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const { archived } = c.req.valid("query");
    const { authContext, workspaceContext } = c.var;

    if (archived === "true") {
      if (!isUserAuthContext(authContext)) {
        throw badRequest("Only people can read archived Tasks.");
      }
      const { userId } = requireUserContext(authContext);
      const { workspaceId: archivedWorkspaceId } =
        requireWorkspaceContext(workspaceContext);
      // Same rows as GET /tasks?archived=true lists.
      const archivedTask = await prisma.task.findFirst({
        where: {
          id: await resolveTaskRefToId(id, archivedWorkspaceId, prisma),
          archivedAt: { not: null },
          workspaceId: archivedWorkspaceId,
          ...buildHumanTaskVisibilityWhere(userId),
        },
        include: buildTaskIncludeForViewer(authContext, archivedWorkspaceId),
      });
      if (!archivedTask) {
        throw notFound("Task not found");
      }
      return ok(c, taskSchema.parse(mapTask(archivedTask, authContext)));
    }

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
