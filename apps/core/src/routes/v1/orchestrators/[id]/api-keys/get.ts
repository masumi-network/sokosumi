import { createRoute, z } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { orchestratorApiKeySchema } from "@/schemas/orchestrator-api-key.schema";

import { orchestratorApiKeySelect } from "../../api-keys-shared";
import { paramsSchema } from "../../schema";

const route = createRoute({
  method: "get",
  path: "/{id}/api-keys",
  description: "List orchestrator API keys (admin only)",
  tags: ["Orchestrators"],
  request: {
    params: paramsSchema,
  },
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
    requireAdminAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const orchestrator = await prisma.orchestrator.findFirst({
      where: { id, archivedAt: null },
      select: { id: true },
    });

    if (!orchestrator) {
      throw notFound("Orchestrator not found");
    }

    const keys = await prisma.orchestratorApiKey.findMany({
      where: { orchestratorId: id },
      select: orchestratorApiKeySelect,
      orderBy: { createdAt: "desc" },
    });

    return ok(c, keys);
  });
}
