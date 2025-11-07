import { createRoute, z } from "@hono/zod-openapi";
import { agentRepository } from "@sokosumi/database/repositories";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

const agentSchema = z
  .object({
    id: z.string().openapi({ example: "agent_123" }),
    name: z.string().openapi({ example: "Research Assistant" }),
  })
  .openapi("Agent");

const agentsSchema = z.array(agentSchema);

const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Agents"],
  responses: {
    200: jsonSuccessResponse(agentsSchema, "Retrieve all agents"),
    401: jsonErrorResponse("Unauthorized"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const agents = await agentRepository.getAgentsWithRelations();
    const response = agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
    }));

    return ok(c, agentsSchema.parse(response));
  });
}
