import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskAccess } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTaskComment } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { taskCommentSchema } from "@/schemas/task.schema";

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
  method: "get",
  path: "/{id}/comments/{commentId}",
  description: "Retrieve task comment",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(taskCommentSchema, "Retrieve task comment"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id, commentId } = c.req.valid("param");

    const comment = await prisma.$transaction(async (tx) => {
      await requireTaskAccess(authContext, id, tx);

      return tx.taskComment.findFirst({
        where: {
          id: commentId,
          taskId: id,
        },
        include: { attachments: true },
      });
    });

    if (!comment) {
      throw notFound("Task comment not found");
    }

    return ok(c, taskCommentSchema.parse(mapTaskComment(comment)));
  });
}
