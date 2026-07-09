import { createRoute, z } from "@hono/zod-openapi";

import {
  getTaskCannotArchiveMessage,
  isTaskArchivableStatus,
} from "@sokosumi/utils";

import { requireTaskOwnership } from "@/helpers/access-control";
import { unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
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
  description: "Archive task",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(taskSchema, "Archive task"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = requireUserContext(authContext);
    const { id } = c.req.valid("param");

    const task = await prisma.$transaction(async (tx) => {
      const currentTask = await requireTaskOwnership(userContext, id, tx, {
        allowAwaitingVendorApproval: true,
      });

      if (!isTaskArchivableStatus(currentTask.status)) {
        throw unprocessableEntity(
          getTaskCannotArchiveMessage(currentTask.status),
        );
      }

      return tx.task.update({
        where: {
          id,
          userId: userContext.userId,
          archivedAt: null,
          status: currentTask.status,
        },
        data: {
          archivedAt: new Date(),
        },
        include: buildTaskIncludeForViewer(
          authContext,
          currentTask.workspaceId,
        ),
      });
    });

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}
