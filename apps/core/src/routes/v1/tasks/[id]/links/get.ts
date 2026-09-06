import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTaskLinksForTask } from "@/helpers/task-link";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { taskLinksSchema } from "@/schemas/task-link.schema";
import { buildVisibleTaskLinksInclude } from "@/types/task-link";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/links",
  description: "List links between this task and other tasks",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(taskLinksSchema, "Task links"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    await requireTaskReadForRouteVars(c.var, id, prisma);
    const row = await prisma.task.findUnique({
      where: { id, archivedAt: null },
      select: {
        id: true,
        ...buildVisibleTaskLinksInclude(
          c.var.authContext,
          c.var.workspaceContext?.workspaceId,
        ),
      },
    });

    if (!row) {
      throw notFound("Task not found");
    }

    const links = mapTaskLinksForTask(row.linksFrom, row.linksTo);
    return ok(c, links);
  });
}
