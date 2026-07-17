import { createRoute } from "@hono/zod-openapi";

import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOrchestratorAuthContext } from "@/middleware/auth";
import {
  orchestratorApiKeySchema,
  updateOrchestratorApiKeyRequestSchema,
} from "@/schemas/orchestrator-api-key.schema";

import { orchestratorApiKeySelect } from "../../api-keys-shared";
import { meApiKeyParamsSchema } from "../../schema";

const route = createRoute({
  method: "patch",
  path: "/me/api-keys/{keyId}",
  description: "Update API key for the current orchestrator",
  tags: ["Orchestrators"],
  request: {
    params: meApiKeyParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: updateOrchestratorApiKeyRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      orchestratorApiKeySchema,
      "Update orchestrator API key",
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
    const body = c.req.valid("json");
    const orchestratorId = authContext.orchestratorId;

    const updatedResult = await prisma.orchestratorApiKey.updateMany({
      where: {
        id: keyId,
        orchestratorId,
        orchestrator: { archivedAt: null },
      },
      data: {
        name: body.name,
        expiresAt:
          body.expiresAt === undefined
            ? undefined
            : body.expiresAt === null
              ? null
              : new Date(body.expiresAt),
      },
    });

    if (updatedResult.count === 0) {
      throw notFound("Orchestrator API key not found");
    }

    const updatedKey = await prisma.orchestratorApiKey.findFirst({
      where: {
        id: keyId,
        orchestratorId,
        orchestrator: { archivedAt: null },
      },
      select: orchestratorApiKeySelect,
    });

    if (!updatedKey) {
      throw notFound("Orchestrator API key not found");
    }

    return ok(c, updatedKey);
  });
}
