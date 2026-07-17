import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOrchestratorAuthContext } from "@/middleware/auth";
import { orchestratorApiKeySchema } from "@/schemas/orchestrator-api-key.schema";

import { orchestratorApiKeySelect } from "../../api-keys-shared";

const route = createRoute({
  method: "get",
  path: "/me/api-keys",
  description: "List API keys for the current orchestrator",
  tags: ["Orchestrators"],
  responses: {
    200: jsonSuccessResponse(
      z.array(orchestratorApiKeySchema),
      "Retrieve orchestrator API keys",
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
      where: { id: authContext.orchestratorId, archivedAt: null },
      select: { id: true },
    });

    if (!orchestrator) {
      throw notFound("Orchestrator not found");
    }

    const keys = await prisma.orchestratorApiKey.findMany({
      where: { orchestratorId: authContext.orchestratorId },
      select: orchestratorApiKeySelect,
      orderBy: { createdAt: "desc" },
    });

    return ok(c, keys);
  });
}
