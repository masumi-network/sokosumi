import { createRoute, z } from "@hono/zod-openapi";

import {
  requireOrchestratorAccess,
  requireTaskAccess,
} from "@/helpers/access-control";
import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { validateStatusTransition } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  createTaskEventRequestSchema,
  taskEventSchema,
} from "@/schemas/task.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
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
    const actor = body.actor ?? { type: "user" };

    const event = await prisma.$transaction(async (tx) => {
      await requireTaskAccess(authContext, id, tx);

      const task = await tx.task.findUnique({
        where: { id },
        select: { status: true, orchestratorId: true },
      });

      if (!task) {
        throw notFound("Task not found");
      }

      if (actor.type === "orchestrator") {
        await requireOrchestratorAccess(authContext, actor.orchestratorId, tx);
        if (task.orchestratorId !== actor.orchestratorId) {
          throw forbidden("Orchestrator does not match task");
        }
      }

      validateStatusTransition(task.status, body.status);

      if (task.status !== body.status) {
        await tx.task.update({
          where: { id },
          data: { status: body.status },
        });
      }

      return tx.taskEvents.create({
        data: {
          taskId: id,
          status: body.status,
          userId: actor.type === "user" ? authContext.userId : null,
          orchestratorId:
            actor.type === "orchestrator" ? actor.orchestratorId : null,
        },
      });
    });

    return created(c, taskEventSchema.parse(event));
  });
}
