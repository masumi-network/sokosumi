import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/utils";
import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  isCoworkerAuthContext,
  isUserAuthContext,
  requireCoworkerAuthContext,
} from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { taskSchema } from "@/schemas/task.schema";
import { buildTaskIncludeForViewer } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}",
  description: "Retrieve task details",
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

    await requireTaskReadForRouteVars(c.var, id);

    let task;
    if (
      isUserAuthContext(authContext) ||
      (isCoworkerAuthContext(authContext) && authContext.context)
    ) {
      const requiredWorkspaceContext =
        requireWorkspaceContext(workspaceContext);

      task = await prisma.task.findUnique({
        where: {
          id,
          archivedAt: null,
          workspaceId: requiredWorkspaceContext.workspaceId,
        },
        include: buildTaskIncludeForViewer(
          authContext,
          requiredWorkspaceContext.workspaceId,
        ),
      });
    } else {
      const coworkerAuthContext = requireCoworkerAuthContext(authContext);

      task = await prisma.task.findUnique({
        where: {
          id,
          archivedAt: null,
          status: { not: TaskStatus.DRAFT },
        },
        include: buildTaskIncludeForViewer(coworkerAuthContext),
      });
    }

    if (!task) {
      throw notFound("Task not found");
    }

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}
