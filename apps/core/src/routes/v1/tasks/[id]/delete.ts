import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { forbidden } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTask } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { taskInclude } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const responseSchema = z.object({
  id: z.string(),
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
    200: jsonSuccessResponse(responseSchema, "Delete task"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");

    const task = await prisma.task.delete({ 
      where: { 
        id, 
        userId: authContext.userId, 
        status: TaskStatus.DRAFT, 
      },
      include: taskInclude
    });

    if (!task) {
      throw forbidden("You can only delete your own draft or ready tasks");
    }

    return ok(c, mapTask(task));
  });
}
