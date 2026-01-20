import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskAccess } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTaskComment } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  taskCommentSchema,
  updateTaskCommentRequestSchema,
} from "@/schemas/task.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
  commentId: z.string().openapi({
    param: { name: "commentId", in: "path" },
    example: "com_123",
  }),
});

const route = createRoute({
  method: "patch",
  path: "/{id}/comments/{commentId}",
  description: "Update task comment",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: updateTaskCommentRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(taskCommentSchema, "Update task comment"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id, commentId } = c.req.valid("param");
    const body = c.req.valid("json");

    const comment = await prisma.$transaction(async (tx) => {
      await requireTaskAccess(authContext, id, tx);

      const updated = await tx.taskComment.updateMany({
        where: {
          id: commentId,
          taskId: id,
        },
        data: { content: body.content },
      });

      if (updated.count === 0) {
        return null;
      }

      return tx.taskComment.findUnique({
        where: { id: commentId },
        include: { attachments: true },
      });
    });

    if (!comment) {
      throw notFound("Task comment not found");
    }

    return ok(
      c,
      taskCommentSchema.parse(mapTaskComment(comment, authContext.userId)),
    );
  });
}
