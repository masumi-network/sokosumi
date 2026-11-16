import { createRoute, z } from "@hono/zod-openapi";

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
  method: "delete",
  path: "/{id}/star",
  description:
    "Unstar an Agent for the current user. Idempotent, and works for an Agent no longer in the catalog.",
  tags: ["Agents"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(agentStarSchema, "Agent unstarred"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    // Scoped to the caller, so it can only ever remove their own star.
    await prisma.agentStar.deleteMany({ where: { userId, agentId: id } });

    return ok(c, agentStarSchema.parse({ agentId: id, starredAt: null }));
  });
}
