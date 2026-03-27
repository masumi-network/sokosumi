import { createRoute, z } from "@hono/zod-openapi";

import { requireScopedTaskReadAccess } from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { taskScopeQuerySchema } from "@/helpers/scope";
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

const querySchema = z.object({
  scope: taskScopeQuerySchema,
});

const route = createRoute({
  method: "get",
  path: "/{id}/links",
  description: "List links between this task and other tasks",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
    query: querySchema,
  },
  responses: {
    200: jsonSuccessResponse(taskLinksSchema, "Task links"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");
    const { scope } = c.req.valid("query");

    const row = await prisma.$transaction(async (tx) => {
      await requireScopedTaskReadAccess(authContext, id, scope, tx);
      return tx.task.findUnique({
        where: { id, archivedAt: null },
        select: {
          id: true,
          ...buildVisibleTaskLinksInclude(authContext, scope),
        },
      });
    });

    if (!row) {
      throw notFound("Task not found");
    }

    const links = mapTaskLinksForTask(row.linksFrom, row.linksTo);
    return ok(c, links);
  });
}
