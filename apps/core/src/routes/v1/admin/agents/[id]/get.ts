import { createRoute } from "@hono/zod-openapi";

import { mapAdminAgentDetail } from "@/helpers/admin-agent";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { getAgent } from "@/lib/agent-catalog/admin";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  adminAgentDetailSchema,
  adminAgentIdParamSchema,
} from "@/schemas/admin-agent.schema";

const route = createRoute({
  method: "get",
  path: "/{id}",
  operationId: "getAdminAgent",
  description:
    "Get an agent registry snapshot, metadata override, and resolved preview fields (admin only).",
  tags: ["Admin"],
  request: {
    params: adminAgentIdParamSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      adminAgentDetailSchema,
      "Admin agent detail with registry and override data",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const agent = await getAgent(c.var.networkScope, id);

    if (!agent) {
      throw notFound("Agent not found");
    }

    return ok(c, adminAgentDetailSchema.parse(mapAdminAgentDetail(agent)));
  });
}
