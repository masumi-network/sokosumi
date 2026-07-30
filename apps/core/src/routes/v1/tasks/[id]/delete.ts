import { createRoute, z } from "@hono/zod-openapi";

import {
  canArchiveTaskStatus,
  getTaskCannotArchiveMessage,
} from "@sokosumi/utils";

import { requireTaskArchiveAccess } from "@/helpers/access-control";
import { conflict, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { cascadeArchiveScheduleParentChildren, mapTask } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { taskSchema } from "@/schemas/task.schema";
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
    "Archive task. Owners may archive any of their tasks (including parked). Organization owners/admins may archive parked tasks awaiting vendor workspace grant approval. Organization workspace members may archive scheduled tasks in the active workspace (same scoping as cancel). Archiving a schedule template also archives its schedule runs (TaskLinkType.SCHEDULE).",
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

      if (!canArchiveTaskStatus(currentTask.status)) {
        throw unprocessableEntity(
          getTaskCannotArchiveMessage(currentTask.status),
        );
      }

      const archivedAt = new Date();
      const updateResult = await tx.task.updateMany({
        where: {
          id,
          archivedAt: null,
          status: currentTask.status,
        },
        data: {
          archivedAt,
        },
      });

      if (updateResult.count === 0) {
        throw conflict("Task was modified concurrently; retry archive");
      }

      await cascadeArchiveScheduleParentChildren({
        tx,
        parentTaskId: id,
        archivedAt,
      });

      return tx.task.findFirstOrThrow({
        where: { id },
        include: buildTaskIncludeForViewer(
          authContext,
          currentTask.workspaceId,
        ),
      });
    });

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}
