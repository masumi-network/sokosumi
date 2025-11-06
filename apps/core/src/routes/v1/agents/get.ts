import { createRoute, z } from "@hono/zod-openapi";
import { agentRepository } from "@sokosumi/database/repositories";
import { Context } from "hono";

import type { Endpoint } from "@/helpers/endpoint";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";

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

async function handler(c: Context) {
  const agents = await agentRepository.getAgentsWithRelations();
  const response = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
  }));

  return ok(c, agentsSchema.parse(response));
}

const schemas = { response: agentsSchema };

const endpoint: Endpoint<typeof schemas> = {
  schemas,
  route,
  handler,
};

export default endpoint;
