import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskArchiveAccess } from "@/helpers/access-control";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
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
    "Archive task. Owners may archive any of their tasks (including parked). Organization owners/admins may archive parked tasks awaiting vendor workspace grant approval. Active Calendar schedule series fail with 409 (kind: schedule_active), including for organization workspace collaborators; released schedule runs are independent tasks and are never archived with their template.",
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
    requireOwnerUserContext(authContext);
    const { id } = c.req.valid("param");

    const task = await prisma.$transaction(async (tx) => {
      const currentTask = await requireTaskArchiveAccess(c.var, id, tx);

      await archiveTaskRecord(tx, currentTask);

      return tx.task.findFirstOrThrow({
        where: { id },
        include: buildTaskIncludeForViewer(
          authContext,
          currentTask.workspaceId,
        ),
      });
    });

    return ok(c, taskSchema.parse(mapTask(task, authContext)));
  });
}
