import { createRoute, z } from "@hono/zod-openapi";
import { agentRepository } from "@sokosumi/database/repositories";
import { Context } from "hono";

import type { Endpoint } from "@/helpers/endpoint";
import { errorResponseSchema } from "@/helpers/error";
import { ok, successResponseSchema } from "@/helpers/response";

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
    200: {
      content: {
        "application/json": {
          schema: successResponseSchema(agentsSchema),
        },
      },
      description: "Retrieve all agents",
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal Server Error",
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
    },
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

const schemas = { agentSchema, agentsSchema };

const endpoint: Endpoint<typeof schemas> = {
  schemas,
  route,
  handler,
  tags: ["Agents"],
};

export default endpoint;
