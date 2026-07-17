import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { mapOrchestrator } from "@/helpers/orchestrator";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOrchestratorAuthContext } from "@/middleware/auth";
import { orchestratorSchema } from "@/schemas/orchestrator.schema";

const route = createRoute({
  method: "get",
  path: "/me",
  description: "Get current authenticated orchestrator",
  tags: ["Orchestrators"],
  responses: {
    200: jsonSuccessResponse(
      orchestratorSchema,
      "Retrieve the current orchestrator",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireOrchestratorAuthContext(c.var.authContext);

    const orchestrator = await prisma.orchestrator.findFirst({
      where: {
        id: authContext.orchestratorId,
        archivedAt: null,
      },
    });

    if (!orchestrator) {
      throw notFound("Orchestrator not found");
    }

    return ok(c, mapOrchestrator(orchestrator));
  });
}
