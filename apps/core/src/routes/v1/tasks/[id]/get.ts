import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskReadAccess } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { taskSchema } from "@/schemas/task.schema";
import { buildTaskIncludeForViewer } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}",
  description: "Retrieve task details",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(taskSchema, "Retrieve task"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext, workspaceContext } = c.var;
    const { id } = c.req.valid("param");

    const task = await prisma.$transaction(async (tx) => {
      await requireTaskReadAccess(authContext, workspaceContext, id, tx);
      return tx.task.findUnique({
        where: { id, archivedAt: null },
        include: buildTaskIncludeForViewer(authContext, workspaceContext),
      });
    });

    if (!task) {
      throw notFound("Task not found");
    }

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}
