import { createRoute } from "@hono/zod-openapi";

import { requireOrchestratorAccess } from "@/helpers/access-control";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { mapTaskDetail } from "@/helpers/task-manager";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  createTaskRequestSchema,
  taskDetailSchema,
} from "@/schemas/task-manager.schema";
import { taskWithDetailsInclude } from "@/types/task";

const route = createRoute({
  method: "post",
  path: "/tasks",
  description: "Create task",
  tags: ["Task Manager"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createTaskRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(taskDetailSchema, "Create task"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const body = c.req.valid("json");

    const task = await prisma.$transaction(async (tx) => {
      if (body.orchestratorId) {
        await requireOrchestratorAccess(authContext, body.orchestratorId, tx);
      }

      return tx.task.create({
        data: {
          userId: authContext.userId,
          name: body.name,
          description: body.description ?? null,
          orchestratorId: body.orchestratorId ?? null,
        },
        include: taskWithDetailsInclude,
      });
    });

    return created(c, taskDetailSchema.parse(mapTaskDetail(task)));
  });
}
