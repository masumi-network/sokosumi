import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskReadAccess } from "@/helpers/access-control";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTaskEvent } from "@/helpers/task";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { taskEventSchema } from "@/schemas/task.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/events",
  description: "List task events",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(z.array(taskEventSchema), "Retrieve task events"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext, workspaceContext } = c.var;
    const { id } = c.req.valid("param");

    const events = await prisma.$transaction(async (tx) => {
      await requireTaskReadAccess(authContext, workspaceContext, id, tx);

      return tx.taskEvent.findMany({
        where: { taskId: id },
        orderBy: { createdAt: "asc" },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
          transaction: {
            select: { amount: true },
          },
        },
      });
    });

    return ok(c, z.array(taskEventSchema).parse(events.map(mapTaskEvent)));
  });
}
