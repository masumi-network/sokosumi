import { createRoute, z } from "@hono/zod-openapi";

import {
  requireOrchestratorAccess,
  requireTaskAccess,
} from "@/helpers/access-control";
import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { validateStatusTransition } from "@/helpers/task";
import { mapTaskDetail } from "@/helpers/task-manager";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  taskCommandRequestSchema,
  taskDetailSchema,
} from "@/schemas/task-manager.schema";
import { taskWithDetailsInclude } from "@/types/task";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "post",
  path: "/tasks/{id}/actions",
  description: "Execute task action",
  tags: ["Task Manager"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: taskCommandRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(taskDetailSchema, "Execute task action"),
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

    const task = await prisma.$transaction(async (tx) => {
      await requireTaskAccess(authContext, id, tx);
      const task = await tx.task.findUnique({
        where: { id },
      });

      if (!task) {
        throw notFound("Task not found");
      }

      if (body.actor.type === "orchestrator") {
        await requireOrchestratorAccess(
          authContext,
          body.actor.orchestratorId,
          tx,
        );

        if (
          body.action.type !== "SET_ORCHESTRATOR" &&
          task.orchestratorId !== body.actor.orchestratorId
        ) {
          throw forbidden("Orchestrator does not match task");
        }
      }

      let statusForEvent = task.status;
      const updateData: {
        status?: typeof task.status;
        orchestratorId?: string | null;
      } = {};

      if (body.action.type === "SET_STATUS") {
        validateStatusTransition(task.status, body.action.to);
        statusForEvent = body.action.to;
        updateData.status = body.action.to;
      }

      if (body.action.type === "SET_ORCHESTRATOR") {
        const nextOrchestratorId = body.action.orchestratorId ?? null;
        if (nextOrchestratorId) {
          await requireOrchestratorAccess(authContext, nextOrchestratorId, tx);
        }
        updateData.orchestratorId = nextOrchestratorId;
      }

      if (Object.keys(updateData).length > 0) {
        await tx.task.update({
          where: { id },
          data: updateData,
        });
      }

      await tx.taskEvents.create({
        data: {
          taskId: id,
          status: statusForEvent,
          userId: body.actor.type === "user" ? authContext.userId : null,
          orchestratorId:
            body.actor.type === "orchestrator"
              ? body.actor.orchestratorId
              : null,
        },
      });

      if (body.action.type === "COMMENT") {
        await tx.taskComment.create({
          data: {
            taskId: id,
            content: body.action.body,
            userId: body.actor.type === "user" ? authContext.userId : null,
            orchestratorId:
              body.actor.type === "orchestrator"
                ? body.actor.orchestratorId
                : null,
          },
        });
      }

      return tx.task.findUnique({
        where: { id },
        include: taskWithDetailsInclude,
      });
    });

    if (!task) {
      throw notFound("Task not found");
    }

    return ok(c, taskDetailSchema.parse(mapTaskDetail(task)));
  });
}
