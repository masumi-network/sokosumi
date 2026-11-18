import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskWriteAccess } from "@/helpers/access-control";
import { lockTaskRows } from "@/helpers/calendar-locks";
import { unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import { subtaskPositionAfter } from "@/helpers/task-subtasks";
import prisma from "@/lib/db/prisma";
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
    afterTaskId: z.string().nullable().openapi({
      description:
        "The sibling sub-task this one goes directly after, or null to make it first.",
      example: "01960001-0001-7001-8001-000000000003",
    }),
  })
  .openapi("MoveTaskRequest");

const route = createRoute({
  method: "post",
  path: "/{id}/move",
  description:
    "Reorder a sub-task among its parent's sub-tasks, in any status. Same access as editing the Task. The parent never changes.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: { content: { "application/json": { schema: bodySchema } } },
  },
  responses: {
    200: jsonSuccessResponse(taskSchema, "Moved sub-task"),
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
    const { afterTaskId } = c.req.valid("json");

    const task = await prisma.$transaction(async (tx) => {
      const subtask = await requireTaskWriteAccess(userContext, id, tx, {
        right: "edit",
      });
      if (!subtask.parentTaskId) {
        throw unprocessableEntity("Only a sub-task can be reordered");
      }
      // The same lock sub-task creates take, so sibling writes serialize.
      await lockTaskRows(tx, [subtask.parentTaskId]);
      const position = await subtaskPositionAfter(tx, {
        parentTaskId: subtask.parentTaskId,
        taskId: subtask.id,
        afterTaskId,
      });
      await tx.task.update({ where: { id: subtask.id }, data: { position } });
      return tx.task.findFirstOrThrow({
        where: { id: subtask.id },
        include: buildTaskIncludeForViewer(authContext, subtask.workspaceId),
      });
    });

    return ok(c, taskSchema.parse(mapTask(task, authContext)));
  });
}
