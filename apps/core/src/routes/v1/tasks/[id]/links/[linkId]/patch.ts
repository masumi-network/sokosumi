import { createRoute, z } from "@hono/zod-openapi";

import { requireUserTaskAccess } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTaskLinkForTask } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  patchTaskLinkRequestSchema,
  taskLinkSchema,
} from "@/schemas/task.schema";

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
  method: "patch",
  path: "/{id}/links/{linkId}",
  description: "Update a task link that involves this task",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: patchTaskLinkRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(taskLinkSchema, "Task link updated"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);
    const { id, linkId } = c.req.valid("param");
    const { type, note } = c.req.valid("json");

    const link = await prisma.$transaction(async (tx) => {
      const currentLink = await tx.taskLink.findUnique({
        where: { id: linkId },
      });

      if (
        !currentLink ||
        (currentLink.fromTaskId !== id && currentLink.toTaskId !== id)
      ) {
        throw notFound("Task link not found");
      }

      await requireUserTaskAccess(authContext, id, tx);

      return await tx.taskLink.update({
        where: { id: linkId },
        data: {
          ...(type !== undefined ? { type } : {}),
          ...(note !== undefined ? { note } : {}),
        },
      });
    });

    return ok(c, mapTaskLinkForTask(id, link));
  });
}
