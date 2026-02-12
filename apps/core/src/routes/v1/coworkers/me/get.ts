import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { coworkerSchema } from "@/schemas/task.schema";

import { requireCoworkerId } from "./helper";

const route = createRoute({
  method: "get",
  path: "/",
  description: "Get current authenticated coworker",
  tags: ["Coworkers"],
  responses: {
    200: jsonSuccessResponse(coworkerSchema, "Retrieve the current coworker", {
      data: {
        id: "cow_123",
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
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const coworkerId = requireCoworkerId(authContext);

    const coworker = await prisma.coworker.findUnique({
      where: { id: coworkerId },
    });

    if (!coworker) {
      throw notFound("Coworker not found");
    }

    return ok(c, coworkerSchema.parse(coworker));
  });
}
