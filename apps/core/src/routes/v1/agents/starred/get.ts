import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { starredAgentsSchema } from "@/schemas/agent.schema";

const route = createRoute({
  method: "get",
  path: "/starred",
  description:
    "The Agents the current user starred. A star is personal: it is never shared with a workspace, and only the session user may read their own.",
  tags: ["Agents"],
  responses: {
    200: jsonSuccessResponse(starredAgentsSchema, "Starred Agent ids"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);

    const stars = await prisma.agentStar.findMany({
      where: { userId },
      orderBy: { starredAt: "asc" },
      select: { agentId: true },
    });

    return ok(
      c,
      starredAgentsSchema.parse({ agentIds: stars.map((s) => s.agentId) }),
    );
  });
}
