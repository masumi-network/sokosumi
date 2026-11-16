import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { agentStarSchema } from "@/schemas/agent.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i",
  }),
});

const route = createRoute({
  method: "post",
  path: "/{id}/star",
  description:
    "Star an Agent for the current user. Personal and private. Idempotent: starring an already starred Agent keeps the original starredAt.",
  tags: ["Agents"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(agentStarSchema, "Agent starred"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // A star belongs to a person, so a coworker or Soko Bot may not set one.
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const agent = await prisma.agent.findFirst({
      where: { id, isShown: true },
      select: { id: true },
    });
    if (!agent) {
      throw notFound("Agent not found");
    }

    const key = { userId, agentId: agent.id };
    // `update: {}` keeps the first starredAt, so a double click never reorders.
    const star = await prisma.agentStar.upsert({
      where: { userId_agentId: key },
      create: key,
      update: {},
      select: { starredAt: true },
    });

    return ok(
      c,
      agentStarSchema.parse({ agentId: agent.id, starredAt: star.starredAt }),
    );
  });
}
