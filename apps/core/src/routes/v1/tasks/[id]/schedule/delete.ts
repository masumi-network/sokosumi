import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { requireMutableTaskOwnership } from "@/helpers/access-control";
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
  path: "/{id}/schedule",
  description: "Remove a task schedule",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(taskSchema, "Task schedule removed"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const userContext = requireUserContext(authContext);
    const { id } = c.req.valid("param");

    const task = await prisma.$transaction(async (tx) => {
      const existingTask = await requireMutableTaskOwnership(
        userContext,
        id,
        tx,
      );

      return tx.task.update({
        where: { id },
        data: {
          metadata: null,
          nextRunAt: null,
          ...(existingTask.status === TaskStatus.QUEUED
            ? { status: TaskStatus.DRAFT }
            : {}),
        },
        include: buildTaskIncludeForViewer(
          authContext,
          existingTask.workspaceId,
        ),
      });
    });

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}
