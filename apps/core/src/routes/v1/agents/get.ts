import { createRoute } from "@hono/zod-openapi";
import { agentOrganizationsInclude, AgentStatus } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/database/helpers";

import {
  calculateAgentRatings,
  calculateAverageExecutionTimes,
  canUserAccessAgent,
  getAgentAccessContext,
  getAgentCost,
  getAgentDescription,
  getAgentImage,
  getAgentName,
} from "@/helpers/agent";
import { jsonErrorResponse, jsonPaginatedResponse } from "@/helpers/openapi";
import {
  calculatePaginationMeta,
  okPaginated,
  paginationQuerySchema,
} from "@/helpers/pagination";
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
    request: {
      query: paginationQuerySchema,
    },
    responses: {
      200: jsonPaginatedResponse(
        agentsSchema,
        "Retrieve all agents with pagination",
      ),
      401: jsonErrorResponse("Unauthorized"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { authContext } = c.var;
    const { page, limit } = c.req.valid("query");

    const { agents, total } = await prisma.$transaction(async (tx) => {
      const { userOrganizationIds, creditCosts } = await getAgentAccessContext(
        authContext,
        tx,
      );

      const where = {
        status: AgentStatus.ONLINE,
        isShown: true,
      };

      const [allAgents] = await Promise.all([
        tx.agent.findMany({
          include: {
            ...agentPricingInclude,
            ...agentOrganizationsInclude,
            ...agentJobsCountInclude,
          },
          orderBy: [...agentOrderBy],
          where,
        }),
        tx.agent.count({ where }),
      ]);

      // Filter by access control and transform agents, removing any with invalid pricing
      const agentsWithCredits = allAgents
        .filter((agent) =>
          canUserAccessAgent(
            agent,
            userOrganizationIds,
            authContext.organizationId,
          ),
        )
        .flatMap((agent) => {
          try {
            const cost = getAgentCost(agent, creditCosts);
            return [
              {
                ...agent,
                credits: convertCentsToCredits(cost.cents),
              },
            ];
          } catch {
            return [];
          }
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

      // Apply pagination after filtering
      const paginatedAgents = agentsWithCredits.slice(
        (page - 1) * limit,
        page * limit,
      );

      const agentIds = paginatedAgents.map((agent) => agent.id);

      const averageExecutionTimes = await calculateAverageExecutionTimes(
        agentIds,
        tx,
      );

      const ratingsMap = await calculateAgentRatings(agentIds, tx);

      const agents = paginatedAgents.map((agent) => {
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

      // Note: total is approximate since we filter after querying
      // For exact count, we'd need to apply access control in the query
      return {
        agents,
        total: agentsWithCredits.length,
      };
    });

    const pagination = calculatePaginationMeta(page, limit, total);

    return okPaginated(c, agentsSchema.parse(agents), pagination);
  });
}
