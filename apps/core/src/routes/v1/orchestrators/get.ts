import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { orchestratorSchema } from "@/schemas/task.schema";

const route = createRoute({
  method: "get",
  path: "/",
  description: "List user's orchestrators",
  tags: ["Orchestrators"],
  responses: {
    200: jsonSuccessResponse(
      z.array(orchestratorSchema),
      "Retrieve orchestrators",
      {
        data: [],
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;

    const orchestrators = await prisma.$transaction(async (tx) => {
      return tx.orchestrator.findMany({
        where: {
          userId: authContext.userId,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    });

    return ok(c, z.array(orchestratorSchema).parse(orchestrators));
  });
}
