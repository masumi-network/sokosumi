import { createRoute } from "@hono/zod-openapi";
import { agentOrganizationsInclude, AgentStatus } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";

import {
  canUserAccessAgent,
  getAgentAccessContext,
  transformAgentWithCredits,
} from "@/helpers/agent";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { agentsSchema } from "@/schemas/agent.schema";
import {
  agentJobsCountInclude,
  agentOrderBy,
  agentPricingInclude,
} from "@/types/agent";

const route = createRoute({
  method: "get",
  path: "/",
  tags: ["Agents"],
  responses: {
    200: jsonSuccessResponse(agentsSchema, "Retrieve all agents"),
    401: jsonErrorResponse("Unauthorized"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;

    const agents = await prisma.$transaction(async (tx) => {
      const { userOrganizationIds, creditCosts } = await getAgentAccessContext(
        authContext,
        tx,
      );

      const agents = await tx.agent.findMany({
        include: {
          ...agentPricingInclude,
          ...agentOrganizationsInclude,
          ...agentJobsCountInclude,
        },
        orderBy: [...agentOrderBy],
        where: {
          status: AgentStatus.ONLINE,
          isShown: true,
        },
      });

      return agents
        .filter((agent) =>
          canUserAccessAgent(
            agent,
            userOrganizationIds,
            authContext.organizationId,
          ),
        )
        .map((agent) => {
          return transformAgentWithCredits(agent, creditCosts);
        })
        .filter((agent) => agent !== null);
    });
    return ok(c, agentsSchema.parse(agents));
  });
}
