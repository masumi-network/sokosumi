import { createRoute } from "@hono/zod-openapi";
import { agentOrganizationsInclude } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";

import {
  buildAgentAccessWhereClause,
  calculateAgentRatings,
  calculateAverageExecutionTimes,
  getAgentAccessContext,
  getAgentCost,
  getAgentDescription,
  getAgentImage,
  getAgentName,
} from "@/helpers/agent";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import {
  agentsSchema,
  getAgentLegalFromAgent,
  getAuthorFromAgent,
} from "@/schemas/agent.schema";
import {
  agentJobsCountInclude,
  agentOrderBy,
  agentPricingInclude,
} from "@/types/agent";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description: "List all available agents",
    tags: ["Agents"],
    responses: {
      200: jsonSuccessResponse(agentsSchema, "Retrieve all agents"),
      401: jsonErrorResponse("Unauthorized"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;

    const agents = await prisma.$transaction(async (tx) => {
      const { userOrganizationIds, creditCosts } = await getAgentAccessContext(
        authContext,
        tx,
      );

      const agents = await tx.agent.findMany({
        where: buildAgentAccessWhereClause(
          userOrganizationIds,
          authContext.organizationId,
          creditCosts,
        ),
        orderBy: [...agentOrderBy],
        include: {
          ...agentPricingInclude,
          ...agentOrganizationsInclude,
          ...agentJobsCountInclude,
        },
      });

      const agentsWithCredits = agents
        .map((agent) => {
          const cost = getAgentCost(agent, creditCosts);
          return {
            ...agent,
            credits: convertCentsToCredits(cost.cents),
          };
        })
        .map((agent) => {
          return {
            ...agent,
            name: getAgentName(agent),
            description: getAgentDescription(agent),
            image: getAgentImage(agent),
            author: getAuthorFromAgent(agent),
            legal: getAgentLegalFromAgent(agent),
          };
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
