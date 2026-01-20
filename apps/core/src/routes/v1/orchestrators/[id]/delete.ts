import { createRoute, z } from "@hono/zod-openapi";

import { requireOrchestratorAccess } from "@/helpers/access-control";
import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "orc_123",
  }),
});

const responseSchema = z.object({
  id: z.string(),
});

const route = createRoute({
  method: "delete",
  path: "/{id}",
  description: "Delete orchestrator",
  tags: ["Orchestrators"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(responseSchema, "Delete orchestrator"),
    401: jsonErrorResponse("Unauthorized"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { id } = c.req.valid("param");

    await prisma.$transaction(async (tx) => {
      await requireOrchestratorAccess(authContext, id, tx);
      const taskCount = await tx.task.count({
        where: { orchestratorId: id },
      });
      if (taskCount > 0) {
        throw conflict("Orchestrator cannot be deleted while tasks exist");
      }
      await tx.orchestrator.delete({
        where: { id },
      });
    });

    return ok(c, { id });
  });
}
