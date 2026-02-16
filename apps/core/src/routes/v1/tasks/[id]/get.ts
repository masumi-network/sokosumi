import { createRoute, z } from "@hono/zod-openapi";

import { requireScopedTaskReadAccess } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { taskScopeQuerySchema } from "@/helpers/scope";
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

const querySchema = z.object({
  scope: taskScopeQuerySchema,
});

const route = createRoute({
  method: "get",
  path: "/{id}",
  description: "Retrieve task details",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    query: querySchema,
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
    const { scope } = c.req.valid("query");

    const task = await prisma.$transaction(async (tx) => {
      await requireScopedTaskReadAccess(authContext, id, scope, tx);
      return tx.task.findUnique({
        where: { id },
        include: taskInclude,
      });
    });

    if (!task) {
      throw notFound("Task not found");
    }

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}
