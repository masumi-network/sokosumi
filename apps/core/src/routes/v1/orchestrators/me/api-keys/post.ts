import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOrchestratorAuthContext } from "@/middleware/auth";
import {
  createOrchestratorApiKeyRequestSchema,
  createOrchestratorApiKeyResponseSchema,
} from "@/schemas/orchestrator-api-key.schema";

import { createOrchestratorApiKeyRecord } from "../../api-keys-shared";

const route = createRoute({
  method: "post",
  path: "/me/api-keys",
  description: "Create API key for the current orchestrator",
  tags: ["Orchestrators"],
  request: {
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
    const authContext = requireOrchestratorAuthContext(c.var.authContext);
    const body = c.req.valid("json");

    const apiKey = await createOrchestratorApiKeyRecord({
      orchestratorId: authContext.orchestratorId,
      name: body.name,
      expiresAt: body.expiresAt,
    });

    return created(c, createOrchestratorApiKeyResponseSchema.parse(apiKey));
  });
}
