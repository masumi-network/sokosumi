import { createRoute, z } from "@hono/zod-openapi";

import {
  requireCoworkerTaskAccess,
  requireWorkspaceTaskAccess,
} from "@/helpers/access-control";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { mapTaskLinksForTask } from "@/helpers/task-link";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { isCoworkerAuthContext } from "@/middleware/auth";
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
    const { authContext } = c.var;
    const { id } = c.req.valid("param");

    const row = await prisma.$transaction(async (tx) => {
      if (isCoworkerAuthContext(authContext)) {
        await requireCoworkerTaskAccess(authContext, id, tx);
        const visibleTaskLinksInclude = await buildVisibleTaskLinksInclude(
          authContext,
          tx,
        );

        return tx.task.findUnique({
          where: { id, archivedAt: null },
          select: {
            id: true,
            ...visibleTaskLinksInclude,
          },
        });
      }

      const viewerContext = c.var.workspaceContext ?? authContext;
      await requireWorkspaceTaskAccess(viewerContext, id, tx);
      const visibleTaskLinksInclude = await buildVisibleTaskLinksInclude(
        viewerContext,
        tx,
      );

      return tx.task.findUnique({
        where: { id, archivedAt: null },
        select: {
          id: true,
          ...visibleTaskLinksInclude,
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
