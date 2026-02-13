import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { requireTaskAccess } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { taskSchema } from "@/schemas/task.schema";
import { taskInclude } from "@/types/task";

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
    const { authContext } = c.var;
    const { id } = c.req.valid("param");

    const task = await prisma.$transaction(async (tx) => {
      await requireTaskAccess(authContext, id, tx);
      if (authContext.coworkerId) {
        return tx.task.findUnique({
          where: {
            id,
            coworkerId: authContext.coworkerId,
            status: { not: TaskStatus.DRAFT },
          },
          include: taskInclude,
        });
      }
      if (authContext.userId) {
        return tx.task.findUnique({
          where: {
            id,
            userId: authContext.userId,
            organizationId: authContext.organizationId,
          },
          include: taskInclude,
        });
      }
      return null;
    });

    if (!task) {
      throw notFound("Task not found");
    }

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}
