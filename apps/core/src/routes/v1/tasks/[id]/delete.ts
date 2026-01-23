import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

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
  method: "delete",
  path: "/{id}",
  description: "Delete task",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(taskSchema, "Delete task"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");

    //Only the owner of the task can delete it
    const task = await prisma.task.delete({ 
      where: { 
        id, 
        userId: authContext.userId,
        OR: [
          { status: TaskStatus.DRAFT },
          { status: TaskStatus.READY },
        ],
      },
      include: taskInclude
    });

    return ok(c, taskSchema.parse(mapTask(task)));
  });
}
