import { createRoute, z } from "@hono/zod-openapi";

import { requireMutableTaskOwnership } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";

const deletedSchema = z
  .object({
    deleted: z.literal(true),
  })
  .openapi("TaskLinkDeleted");

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
  linkId: z.string().openapi({
    param: { name: "linkId", in: "path" },
    example: "tl_123",
  }),
});

const route = createRoute({
  method: "delete",
  path: "/{id}/links/{linkId}",
  description: "Delete a task link that involves this task",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(deletedSchema, "Task link deleted"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id, linkId } = c.req.valid("param");

    await prisma.$transaction(async (tx) => {
      const link = await tx.taskLink.findUnique({
        where: { id: linkId },
      });

      if (!link || (link.fromTaskId !== id && link.toTaskId !== id)) {
        throw notFound("Task link not found");
      }

      await requireMutableTaskOwnership(userContext, id, tx);

      await tx.taskLink.delete({
        where: { id: linkId },
      });
    });

    return ok(c, deletedSchema.parse({ deleted: true }));
  });
}
