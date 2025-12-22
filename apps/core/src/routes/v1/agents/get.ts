import { createRoute } from "@hono/zod-openapi";
import { agentOrganizationsInclude, AgentStatus } from "@sokosumi/database";
import prisma from "@sokosumi/database/client";

import {
  calculateAgentRatings,
  calculateAverageExecutionTimes,
  canUserAccessAgent,
  getAgentAccessContext,
  validateAgentCredits,
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

      // Filter by access control and transform agents, removing any with invalid pricing
      const agentsWithCredits = agents
        .filter((agent) =>
          canUserAccessAgent(
            agent,
            userOrganizationIds,
            authContext.organizationId,
          ),
        )
        .flatMap((agent) => {
          const agentWithCredits = validateAgentCredits(agent, creditCosts);
          return agentWithCredits ? [agentWithCredits] : [];
        });

      const agentIds = agentsWithCredits.map((agent) => agent.id);

      const averageExecutionTimes = await calculateAverageExecutionTimes(
        agentIds,
        tx,
      );

      const ratingsMap = await calculateAgentRatings(agentIds, tx);

      return agentsWithCredits.map((agent) => {
        const ratingMetrics = ratingsMap.get(agent.id);
        return {
          ...agent,
          metrics: {
            executions: {
              count: agent._count.jobs,
              averageTime: averageExecutionTimes.get(agent.id) ?? null,
            },
            ratings: {
              total: ratingMetrics?.total ?? 0,
              average: ratingMetrics?.average ?? null,
            },
          },
        };
      });
    });
    return ok(c, agentsSchema.parse(agents));
  });
}
