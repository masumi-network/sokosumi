import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTaskEvent, taskEventApiInclude } from "@/helpers/task";
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
    const { id } = c.req.valid("param");

    await requireTaskReadForRouteVars(c.var, id, prisma);

    const events = await prisma.taskEvent.findMany({
      where: { taskId: id },
      orderBy: { createdAt: "asc" },
      include: taskEventApiInclude,
    });

    return ok(
      c,
      z.array(taskEventSchema).parse(events.map((e) => mapTaskEvent(e))),
    );
  });
}
