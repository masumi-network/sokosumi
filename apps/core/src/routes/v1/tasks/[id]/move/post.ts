import { createRoute, z } from "@hono/zod-openapi";

import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import { moveTask } from "@/helpers/task-subtask-move";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { taskSchema } from "@/schemas/task.schema";
import { buildTaskIncludeForViewer } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "01960001-0001-7001-8001-000000000002",
  }),
});

const bodySchema = z
  .object({
    parentTaskId: z.string().nullable().optional().openapi({
      description:
        "The Task this one goes under. A different Task attaches it or moves it to that parent, with its own sub-tasks. null detaches it, and it keeps its project. Omitted or equal to the current parent keeps the parent.",
      example: "01960001-0001-7001-8001-000000000001",
    }),
    afterTaskId: z.string().nullable().optional().openapi({
      description:
        "The sibling sub-task this one goes directly after, or null to make it first. Omitted keeps the order, or puts it last under a new parent.",
      example: "01960001-0001-7001-8001-000000000003",
    }),
  })
  .refine(
    (data) => data.parentTaskId !== undefined || data.afterTaskId !== undefined,
    {
      message: "At least one of parentTaskId or afterTaskId is required",
      path: ["afterTaskId"],
    },
  )
  .openapi("MoveTaskRequest");

const route = createRoute({
  method: "post",
  path: "/{id}/move",
  description:
    "Move a Task in the sub-task tree, in any status. Same access as editing the Task, and on the new parent. Reorders a sub-task among its siblings, attaches a Task under a parent or moves it to another parent, or detaches it. A Task under a parent in another Project moves to that Project, with its sub-tasks. The parent must be in the same workspace and have the same visibility.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: { content: { "application/json": { schema: bodySchema } } },
  },
  responses: {
    200: jsonSuccessResponse(taskSchema, "Moved Task"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = requireOwnerUserContext(authContext);
    const { id } = c.req.valid("param");
    const { parentTaskId, afterTaskId } = c.req.valid("json");

    const { task, projectChanged } = await serializableTransaction(
      async (tx) => {
        const moved = await moveTask(tx, userContext, {
          taskId: id,
          parentTaskId,
          afterTaskId,
        });
        return {
          projectChanged: moved.projectChanged,
          task: await tx.task.findFirstOrThrow({
            where: { id: moved.task.id },
            include: buildTaskIncludeForViewer(
              authContext,
              moved.task.workspaceId,
            ),
          }),
        };
      },
      "Task changed while moving it. Please retry.",
    );
    if (projectChanged) await deliverCalendarInvalidationsNow(task.workspaceId);

    return ok(c, taskSchema.parse(mapTask(task, authContext)));
  });
}
