import { createRoute } from "@hono/zod-openapi";

import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  createOrchestratorRequestSchema,
  orchestratorSchema,
} from "@/schemas/task-manager.schema";

const route = createRoute({
  method: "post",
  path: "/orchestrators",
  description: "Create orchestrator",
  tags: ["Task Manager"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createOrchestratorRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      orchestratorSchema,
      "Create orchestrator",
      {
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
      },
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const body = c.req.valid("json");

    const orchestrator = await prisma.$transaction(async (tx) => {
      const existing = await tx.orchestrator.findUnique({
        where: { slug: body.slug },
      });

      if (existing) {
        throw conflict("Orchestrator slug is already in use");
      }

      return tx.orchestrator.create({
        data: {
          userId: authContext.userId,
          slug: body.slug,
          name: body.name,
          url: body.url ?? null,
          email: body.email ?? null,
          description: body.description ?? null,
          image: body.image ?? null,
        },
      });
    });

    return created(c, orchestratorSchema.parse(orchestrator));
  });
}
