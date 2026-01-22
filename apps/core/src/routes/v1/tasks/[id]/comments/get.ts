import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskAccess } from "@/helpers/access-control";
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
});

const route = createRoute({
  method: "get",
  path: "/{id}/comments",
  description: "List task comments",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      z.array(taskCommentSchema),
      "Retrieve task comments",
    ),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");

    const comments = await prisma.$transaction(async (tx) => {
      await requireTaskAccess(authContext, id, undefined, tx);
      return tx.taskComment.findMany({
        where: { taskId: id },
        include: { attachments: true },
        orderBy: { createdAt: "asc" },
      });
    });

    return ok(
      c,
      z
        .array(taskCommentSchema)
        .parse(comments.map((comment) => mapTaskComment(comment))),
    );
  });
}
