import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskAccess } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

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

const responseSchema = z.object({
  id: z.string(),
});

const route = createRoute({
  method: "delete",
  path: "/{id}/comments/{commentId}",
  description: "Delete task comment",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(responseSchema, "Delete task comment"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id, commentId } = c.req.valid("param");

    await prisma.$transaction(async (tx) => {
      await requireTaskAccess(authContext, id, tx);

      const deleted = await tx.taskComment.deleteMany({
        where: {
          id: commentId,
          taskId: id,
        },
      });

      if (deleted.count === 0) {
        throw notFound("Task comment not found");
      }
    });

    return ok(c, { id: commentId });
  });
}
