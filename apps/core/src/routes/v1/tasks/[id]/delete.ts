import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskWriteAccess } from "@/helpers/access-control";
import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import { markTaskArchivedRead } from "@/helpers/task-notifications";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { taskSchema } from "@/schemas/task.schema";
import { archiveTaskRecord } from "@/services/task-domain.service";
import { buildTaskIncludeForViewer } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "delete",
  path: "/{id}",
  description:
    "Archive task. The owner, or any member of the task's organization for a public task, may archive it, including a parked task awaiting vendor workspace grant approval. A Task created by a Task Schedule archives like any other Task.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(taskSchema, "Archive task"),
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

    const result = await prisma.$transaction(async (tx) => {
      const currentTask = await requireTaskWriteAccess(userContext, id, tx);

      await archiveTaskRecord(tx, currentTask);

      return {
        task: await tx.task.findFirstOrThrow({
          where: { id },
          include: buildTaskIncludeForViewer(
            authContext,
            currentTask.workspaceId,
          ),
        }),
        workspaceId: currentTask.workspaceId,
      };
    });
    await deliverCalendarInvalidationsNow(result.workspaceId);

    // An archived task can no longer be opened, so every row still asking
    // somebody to act on it stops being a question. Without this the
    // follow-up sync reminds them a day later about a task nobody can act on
    // (SOK-916). Archive is allowed from four non-terminal statuses, so those
    // rows can still be outstanding here.
    await markTaskArchivedRead(result.task);

    return ok(c, taskSchema.parse(mapTask(result.task, authContext)));
  });
}
