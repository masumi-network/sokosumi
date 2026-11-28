import { createRoute } from "@hono/zod-openapi";

import { mapAdminAgentDetail } from "@/helpers/admin-agent";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { deleteOverride } from "@/lib/agent-catalog/admin";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminAgentDetailSchema,
  adminAgentIdParamSchema,
} from "@/schemas/admin-agent.schema";

const route = createRoute({
  method: "delete",
  path: "/{id}/metadata-override",
  operationId: "deleteAdminAgentMetadataOverride",
  description:
    "Delete all Sokosumi metadata overrides for an agent (admin only).",
  tags: ["Admin"],
  request: {
    params: adminAgentIdParamSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      adminAgentDetailSchema,
      "Agent detail after metadata override removal (idempotent when already absent)",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const updatedAgent = await deleteOverride(c.var.networkScope, id);

    return ok(
      c,
      adminAgentDetailSchema.parse(mapAdminAgentDetail(updatedAgent)),
    );
  });
}
