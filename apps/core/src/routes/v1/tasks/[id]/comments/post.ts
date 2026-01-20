import { createRoute, z } from "@hono/zod-openapi";

import {
  requireOrchestratorAccess,
  requireTaskAccess,
} from "@/helpers/access-control";
import { forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { mapTaskComment } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  createTaskCommentRequestSchema,
  taskCommentSchema,
} from "@/schemas/task.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/comments",
  description: "Create task comment",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: createTaskCommentRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(taskCommentSchema, "Create task comment"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const comment = await prisma.$transaction(async (tx) => {
      await requireTaskAccess(authContext, id, tx);
      const task = await tx.task.findUnique({
        where: { id },
        select: { orchestratorId: true },
      });

      if (!task) {
        throw notFound("Task not found");
      }

      const actor = body.actor ?? { type: "user" };

      if (actor.type === "orchestrator") {
        await requireOrchestratorAccess(authContext, actor.orchestratorId, tx);
        if (task.orchestratorId !== actor.orchestratorId) {
          throw forbidden("Orchestrator does not match task");
        }
      }

      return tx.taskComment.create({
        data: {
          taskId: id,
          content: body.content,
          userId: actor.type === "user" ? authContext.userId : null,
          orchestratorId:
            actor.type === "orchestrator" ? actor.orchestratorId : null,
        },
        include: { attachments: true },
      });
    });

    return created(
      c,
      taskCommentSchema.parse(mapTaskComment(comment, authContext.userId)),
    );
  });
}
