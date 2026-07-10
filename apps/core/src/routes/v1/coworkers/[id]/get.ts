import { createRoute } from "@hono/zod-openapi";

import { coworkerInclude, mapCoworker } from "@/helpers/coworker";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { coworkerSchema } from "@/schemas/coworker.schema";

import { paramsSchema } from "./schema";

const route = createRoute({
  method: "get",
  path: "/{id}",
  description: "Retrieve coworker by ID",
  tags: ["Coworkers"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(coworkerSchema, "Retrieve coworker", {
      data: {
        id: "cow_123",
        archivedAt: null,
        priority: 10,
        slug: "ops-agent",
        name: "Ops Agent",
        isWhitelisted: true,
        caption: "Senior Campaign Partner",
        vendor: {
          id: "01960001-0001-7001-8001-000000000001",
          createdAt: "2025-01-01T00:00:00.000Z",
          updatedAt: "2025-01-01T00:00:00.000Z",
          name: "Service Plan",
          slug: "service-plan",
          logos: {
            light: "https://example.com/company-logo",
            dark: null,
          },
        },
        url: "https://example.com",
        baseURL: "https://responses.example.com/v1",
        description: "Ops helper",
        capabilities: ["chat", "tasks"],
        image: "https://example.com/logo",
        metadata: {
          channels: {
            email: "foo@bar.com",
            whatsapp: "+49151xxxx",
          },
        },
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

    const coworker = await prisma.coworker.findFirst({
      where: {
        id,
      },
      include: coworkerInclude,
    });

    if (!coworker) {
      throw notFound("Coworker not found");
    }

    return ok(c, mapCoworker(coworker));
  });
}
