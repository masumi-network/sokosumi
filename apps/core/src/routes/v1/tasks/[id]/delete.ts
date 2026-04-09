import { createRoute, z } from "@hono/zod-openapi";

import { requireOwnedTaskAccess } from "@/helpers/access-control";
import { forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { isTaskArchivableStatus, mapTask } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
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
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const task = await prisma.$transaction(async (tx) => {
      const viewerContext = c.var.workspaceContext ?? authContext;
      const currentTask = await requireOwnedTaskAccess(viewerContext, id, tx);

      if (!isTaskArchivableStatus(currentTask.status)) {
        throw forbidden(
          "You can only archive tasks in DRAFT, READY, CANCELED, COMPLETED, or FAILED state",
        );
      }

      return tx.task.update({
        where: {
          id,
          userId: authContext.userId,
          archivedAt: null,
          status: currentTask.status,
        },
        data: {
          archivedAt: new Date(),
        },
        include: await buildTaskIncludeForViewer(authContext, tx),
      });
    });

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}
