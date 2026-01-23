import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskAccess } from "@/helpers/access-control";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { mapTaskComment } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { taskCommentSchema } from "@/schemas/task.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

export const createTaskCommentRequestSchema = z.object({
  content: z.string().min(1).openapi({ example: "Looks good." }),
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
      return tx.taskComment.create({
        data: {
          task: {
            connect: {
              id,
            },
          },
          content: body.content,
          userId: authContext.orchestratorId ? null : authContext.userId,
          orchestratorId: authContext.orchestratorId ?? null,
        },
        include: { attachments: true },
      });
    });

    return created(c, taskCommentSchema.parse(mapTaskComment(comment)));
  });
}
