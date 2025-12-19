import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { AgentStatus } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { agentsSchema } from "@/schemas/agent.schema";
import { getDeveloperFromAgent } from "@/schemas/developer.schema";

const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Agents"],
  responses: {
    200: jsonSuccessResponse(agentsSchema, "Retrieve all agents"),
    401: jsonErrorResponse("Unauthorized"),
  },
});

export const agentJobsCountOrderBy = {
  jobs: {
    _count: "desc",
  },
} as const;

export const agentCreatedAtOrderBy = {
  createdAt: "desc",
} as const;

export const agentOrderBy = [
  { ...agentJobsCountOrderBy },
  { ...agentCreatedAtOrderBy },
] as const;

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const agents = await prisma.agent.findMany({
      orderBy: [...agentOrderBy],
      where: {
        status: AgentStatus.ONLINE,
        isShown: true,
      },
    });

    const formattedAgents = agents.map((agent) => {
      return {
        ...agent,
        name: agent.overrideName ?? agent.name,
        description: agent.overrideDescription ?? agent.description,
        developer: getDeveloperFromAgent(agent),
      };
    });
    return ok(c, agentsSchema.parse(formattedAgents));
  });
}
