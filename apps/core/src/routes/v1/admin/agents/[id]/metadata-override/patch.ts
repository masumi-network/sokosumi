import { createRoute } from "@hono/zod-openapi";

import { mapAdminAgentDetail } from "@/helpers/admin-agent";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { patchOverride } from "@/lib/agent-catalog/admin";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminAgentDetailSchema,
  adminAgentIdParamSchema,
  patchAdminAgentMetadataOverrideBodySchema,
} from "@/schemas/admin-agent.schema";

const route = createRoute({
  method: "patch",
  path: "/{id}/metadata-override",
  operationId: "patchAdminAgentMetadataOverride",
  description:
    "Create or update Sokosumi metadata overrides for an agent (admin only).",
  tags: ["Admin"],
  request: {
    params: adminAgentIdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: patchAdminAgentMetadataOverrideBodySchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      adminAgentDetailSchema,
      "Updated agent detail with metadata override",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const updatedAgent = await patchOverride(c.var.networkScope, id, body);

    return ok(
      c,
      adminAgentDetailSchema.parse(mapAdminAgentDetail(updatedAgent)),
    );
  });
}
