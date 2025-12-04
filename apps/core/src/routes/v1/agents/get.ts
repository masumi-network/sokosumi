import { createRoute } from "@hono/zod-openapi";
import { agentRepository } from "@sokosumi/database/repositories";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithRequestId } from "@/lib/hono";
import { agentsSchema } from "@/schemas/agent.schema";

const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Agents"],
  responses: {
    200: jsonSuccessResponse(agentsSchema, "Retrieve all agents"),
    401: jsonErrorResponse("Unauthorized"),
  },
});

export default function mount(app: OpenAPIHonoWithRequestId) {
  app.openapi(route, async (c) => {
    const agents = await agentRepository.getAgentsWithRelations();

    return ok(c, agentsSchema.parse(agents));
  });
}
