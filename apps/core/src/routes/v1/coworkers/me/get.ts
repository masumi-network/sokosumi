import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireCoworkerAuthContext } from "@/middleware/auth";
import { coworkerSchema } from "@/schemas/task.schema";

const route = createRoute({
  method: "get",
  path: "/me",
  description: "Get current authenticated coworker",
  tags: ["Coworkers"],
  responses: {
    200: jsonSuccessResponse(coworkerSchema, "Retrieve the current coworker", {
      data: {
        id: "cow_123",
        archivedAt: null,
        slug: "ops-agent",
        name: "Ops Agent",
        isWhitelisted: true,
        caption: "Senior Campaign Partner",
        company: "Serviceplan",
        companyLogo: "https://example.com/company-logo",
        url: "https://example.com",
        baseURL: "https://responses.example.com/v1",
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
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireCoworkerAuthContext(c.var.authContext);

    const coworker = await prisma.coworker.findFirst({
      where: {
        id: authContext.coworkerId,
        archivedAt: null,
      },
    });

    if (!coworker) {
      throw notFound("Coworker not found");
    }

    return ok(c, coworkerSchema.parse(coworker));
  });
}
