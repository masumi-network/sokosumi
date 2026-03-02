import { createRoute } from "@hono/zod-openapi";
import { convertCentsToCredits } from "@sokosumi/database/helpers";

import {
  buildAvailableAgentWhereClause,
  calculateAgentRatings,
  calculateAverageExecutionTimes,
  getAgentCost,
  getAgentDescription,
  getAgentIcon,
  getAgentImage,
  getAgentName,
  getCreditCostsOrThrow,
} from "@/helpers/agent";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
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
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import {
  agentJobsCountInclude,
  agentOrderBy,
  agentPricingInclude,
} from "@/types/agent";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description: "List all available agents (paginated)",
    tags: ["Agents"],
    request: {
      query: cursorPaginationQuerySchema,
    },
    responses: {
      200: jsonPaginatedSuccessResponse(agentsSchema, "Retrieve all agents", {
        data: [],
        meta: {
          timestamp: "2025-01-15T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
          pagination: {
            cursor: null,
            limit: 20,
            total: 100,
            nextCursor: "cmaeygqwa000e8i0s9s7wif8i",
          },
        },
      }),
      401: jsonErrorResponse("Unauthorized"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);

    const result = await prisma.$transaction(async (tx) => {
      const creditCosts = await getCreditCostsOrThrow(tx);

      const where = buildAvailableAgentWhereClause(creditCosts);

      const takePlusOne = take + 1;
      const [agents, count] = await Promise.all([
        tx.agent.findMany({
          where,
          take: takePlusOne,
          skip,
          cursor: cursor ? { id: cursor } : undefined,
          orderBy: [...agentOrderBy, { id: "desc" }],
          include: {
            ...agentPricingInclude,
            ...agentJobsCountInclude,
          },
        }),
        tx.agent.count({ where }),
      ]);

      const agentsWithCredits = agents
        .slice(0, take)
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
            icon: getAgentIcon(agent),
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

      const agentsWithMetrics = agentsWithCredits.map((agent) => {
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

      return {
        agents: agentsWithMetrics,
        count,
        hasMore: agents.length === takePlusOne,
      };
    });

    const paginationMeta = createPaginationMeta(
      result.agents,
      result.count,
      take,
      result.hasMore,
      cursor,
    );

    return ok(c, agentsSchema.parse(result.agents), paginationMeta);
  });
}
