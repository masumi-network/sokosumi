import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskWriteAccess } from "@/helpers/access-control";
import { deliverCalendarInvalidationsNow } from "@/helpers/calendar-invalidation";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { taskSchema } from "@/schemas/task.schema";
import { restoreTaskRecord } from "@/services/task-domain.service";
import { buildTaskIncludeForViewer } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/restore",
  description:
    "Restore an archived task. Same access as archive. A task that was Queued, Ready or waiting for a vendor grant comes back as a Draft without its Run at, so nothing runs until someone starts it again. Draft, Completed, Failed and Canceled tasks keep their status.",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(taskSchema, "Restore task"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = requireOwnerUserContext(authContext);
    const { id } = c.req.valid("param");

    const result = await prisma.$transaction(async (tx) => {
      const archivedTask = await requireTaskWriteAccess(userContext, id, tx, {
        right: "manage",
        archived: true,
      });

      await restoreTaskRecord(tx, archivedTask, {
        kind: "user",
        userId: userContext.userId,
      });

      return {
        task: await tx.task.findFirstOrThrow({
          where: { id },
          include: buildTaskIncludeForViewer(
            authContext,
            archivedTask.workspaceId,
          ),
        }),
        workspaceId: archivedTask.workspaceId,
      };
    });
    await deliverCalendarInvalidationsNow(result.workspaceId);

    return ok(c, taskSchema.parse(mapTask(result.task, authContext)));
  });
}
