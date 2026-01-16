import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskAccess } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTaskDetail } from "@/helpers/task-manager";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  taskDetailSchema,
  updateTaskRequestSchema,
} from "@/schemas/task-manager.schema";
import { taskWithDetailsInclude } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "patch",
  path: "/tasks/{id}",
  description: "Update task metadata",
  tags: ["Task Manager"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: updateTaskRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(taskDetailSchema, "Update task"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

function buildUpdateData(body: z.infer<typeof updateTaskRequestSchema>) {
  return {
    ...(body.name !== undefined && { name: body.name }),
    ...(body.description !== undefined && { description: body.description }),
  };
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const task = await prisma.$transaction(async (tx) => {
      await requireTaskAccess(authContext, id, tx);
      return tx.task.update({
        where: { id },
        data: buildUpdateData(body),
        include: taskWithDetailsInclude,
      });
    });

    if (!task) {
      throw notFound("Task not found");
    }

    return ok(c, taskDetailSchema.parse(mapTaskDetail(task)));
  });
}
