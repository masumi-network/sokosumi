import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { orchestratorSchema } from "@/schemas/task.schema";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "orc_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}",
  description: "Retrieve orchestrator by ID",
  tags: ["Orchestrators"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(orchestratorSchema, "Retrieve orchestrator", {
      data: {
        id: "orc_123",
        slug: "ops-agent",
        name: "Ops Agent",
        url: "https://example.com",
        email: "ops@example.com",
        description: "Ops helper",
        image: "https://example.com/logo",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const orchestrator = await prisma.orchestrator.findUnique({
      where: { id },
    });

    if (!orchestrator) {
      throw notFound("Orchestrator not found");
    }

    return ok(c, orchestratorSchema.parse(orchestrator));
  });
}
