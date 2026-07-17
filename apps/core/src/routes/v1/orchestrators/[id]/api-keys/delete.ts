import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import { orchestratorApiKeySchema } from "@/schemas/orchestrator-api-key.schema";

import { orchestratorApiKeySelect } from "../../api-keys-shared";
import { apiKeyParamsSchema } from "../../schema";

const route = createRoute({
  method: "delete",
  path: "/{id}/api-keys/{keyId}",
  description: "Revoke orchestrator API key (admin only)",
  tags: ["Orchestrators"],
  request: {
    params: apiKeyParamsSchema,
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
    requireAdminAuthContext(c.var.authContext);
    const { id, keyId } = c.req.valid("param");

    const revokedAt = new Date();
    const revokeResult = await prisma.orchestratorApiKey.updateMany({
      where: {
        id: keyId,
        orchestratorId: id,
        revokedAt: null,
        orchestrator: { archivedAt: null },
      },
      data: { revokedAt },
    });

    if (revokeResult.count === 0) {
      const existingKey = await prisma.orchestratorApiKey.findFirst({
        where: {
          id: keyId,
          orchestratorId: id,
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
        orchestratorId: id,
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
