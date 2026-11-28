import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskWriteAccess } from "@/helpers/access-control";
import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { requestJobScope } from "@/helpers/job-projection";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import {
  taskJobProjectionInclude,
  withTaskResponseJobs,
} from "@/helpers/task-job-projection";
import { markTaskArchivedRead } from "@/helpers/task-notifications";
import { retriedTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { taskSchema } from "@/schemas/task.schema";
import { archiveTaskRecord } from "@/services/task-domain-archive";
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
    "Archive task. The owner, or any member of the task's organization for a public task, may archive it, including a parked task awaiting vendor workspace grant approval. A public task without an owner needs an organization owner or admin. A Task created by a Task Schedule archives like any other Task.",
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
    const jobScope = requestJobScope(c.var.networkScope);

    const result = await retriedTransaction(async (tx) => {
      const currentTask = await requireTaskWriteAccess(userContext, id, tx, {
        right: "manage",
      });

      await archiveTaskRecord(tx, currentTask);

      return {
        task: await withTaskResponseJobs(
          await tx.task.findFirstOrThrow({
            where: { id },
            include: taskJobProjectionInclude(
              buildTaskIncludeForViewer(
                authContext,
                currentTask.workspaceId,
                c.var.workspaceContext?.workspaceId,
              ),
              jobScope,
            ),
          }),
          jobScope,
          tx,
        ),
        workspaceId: currentTask.workspaceId,
      };
    }, "Task changed while archiving it. Retry.");
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
