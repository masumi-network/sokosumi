import { createRoute, z } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";

import { requireTaskAccess } from "@/helpers/access-control";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { validateStatusTransition } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { taskEventSchema } from "@/schemas/task.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

export const createTaskEventRequestSchema = z.object({
  status: z.enum(TaskStatus).openapi({ example: TaskStatus.RUNNING }),
  description: z
    .string()
    .nullish()
    .openapi({ example: "Task Event is running" }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/events",
  description: "Create task event",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: createTaskEventRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(taskEventSchema, "Create task event"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const event = await prisma.$transaction(async (tx) => {
      const task = await requireTaskAccess(authContext, id, tx);

      validateStatusTransition(task.status, body.status);

      const updatedTask = await tx.task.update({
        where: { id, status: task.status },
        data: {
          status: body.status,
          events: {
            create: {
              status: body.status,
              description: body.description ?? null,
              userId: authContext.orchestratorId ? null : authContext.userId,
              orchestratorId: authContext.orchestratorId ?? null,
            },
          },
        },
        include: { events: true },
      });
      return updatedTask.events[updatedTask.events.length - 1];
    });

    return created(c, taskEventSchema.parse(event));
  });
}
