import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOrchestratorAuthContext } from "@/middleware/auth";
import { orchestratorApiKeySchema } from "@/schemas/orchestrator-api-key.schema";

import { orchestratorApiKeySelect } from "../../api-keys-shared";
import { meApiKeyParamsSchema } from "../../schema";

const route = createRoute({
  method: "delete",
  path: "/me/api-keys/{keyId}",
  description: "Revoke API key for the current orchestrator",
  tags: ["Orchestrators"],
  request: {
    params: meApiKeyParamsSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      orchestratorApiKeySchema,
      "Revoke orchestrator API key",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireOrchestratorAuthContext(c.var.authContext);
    const { keyId } = c.req.valid("param");
    const orchestratorId = authContext.orchestratorId;

    const revokedAt = new Date();
    const revokeResult = await prisma.orchestratorApiKey.updateMany({
      where: {
        id: keyId,
        orchestratorId,
        revokedAt: null,
        orchestrator: { archivedAt: null },
      },
      data: { revokedAt },
    });

    if (revokeResult.count === 0) {
      const existingKey = await prisma.orchestratorApiKey.findFirst({
        where: {
          id: keyId,
          orchestratorId,
          orchestrator: { archivedAt: null },
        },
        select: orchestratorApiKeySelect,
      });

      if (!existingKey) {
        throw notFound("Orchestrator API key not found");
      }

      return ok(c, existingKey);
    }

    const revokedKey = await prisma.orchestratorApiKey.findFirst({
      where: {
        id: keyId,
        orchestratorId,
        orchestrator: { archivedAt: null },
      },
      select: orchestratorApiKeySelect,
    });

    if (!revokedKey) {
      throw notFound("Orchestrator API key not found");
    }

    return ok(c, revokedKey);
  });
}
