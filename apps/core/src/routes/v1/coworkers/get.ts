import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { coworkerSchema } from "@/schemas/task.schema";

const route = createRoute({
  method: "get",
  path: "/",
  description: "List available coworkers",
  tags: ["Coworkers"],
  responses: {
    200: jsonSuccessResponse(
      z.array(coworkerSchema),
      "Retrieve coworkers",
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
    const coworkers = await prisma.coworker.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    return ok(c, z.array(coworkerSchema).parse(coworkers));
  });
}
