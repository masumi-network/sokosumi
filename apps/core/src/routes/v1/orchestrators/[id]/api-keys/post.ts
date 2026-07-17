import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireAdminAuthContext } from "@/middleware/auth";
import {
  createOrchestratorApiKeyRequestSchema,
  createOrchestratorApiKeyResponseSchema,
} from "@/schemas/orchestrator-api-key.schema";

import { createOrchestratorApiKeyRecord } from "../../api-keys-shared";
import { paramsSchema } from "../../schema";

const route = createRoute({
  method: "post",
  path: "/{id}/api-keys",
  description: "Create orchestrator API key (admin only)",
  tags: ["Orchestrators"],
  request: {
    params: paramsSchema,
    body: {
      content: {
        "application/json": {
          schema: createOrchestratorApiKeyRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      createOrchestratorApiKeyResponseSchema,
      "Create orchestrator API key",
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
    const body = c.req.valid("json");

    const apiKey = await createOrchestratorApiKeyRecord({
      orchestratorId: id,
      name: body.name,
      expiresAt: body.expiresAt,
    });

    return created(c, createOrchestratorApiKeyResponseSchema.parse(apiKey));
  });
}
