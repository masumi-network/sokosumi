import { createRoute, z } from "@hono/zod-openapi";
import { convertCentsToCredits } from "@sokosumi/utils";

import {
  AGENT_PRICING_READ_TRANSACTION_OPTIONS,
  buildAvailableAgentWhereClause,
  calculateAverageExecutionTime,
  getAgentDescription,
  getAgentIcon,
  getAgentImage,
  getAgentName,
  getCardanoV2ReadySources,
  getCreditCostsOrThrow,
} from "@/helpers/agent";
import { getAgentCost } from "@/helpers/agent-cost";
import { calculateAgentRating } from "@/helpers/agent-rating";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import {
  agentDetailSchema,
  getAgentExampleOutputsFromAgent,
  getAgentLegalFromAgent,
  getAgentTagsFromAgent,
  getAuthorFromAgent,
} from "@/schemas/agent.schema";
import { mapCategoryForApi } from "@/schemas/category.schema";
import { agentDetailInclude } from "@/types/agent";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i",
  }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}",
    description: "Get agent details by ID",
    tags: ["Agents"],
    request: {
      params,
    },
    responses: {
      200: jsonSuccessResponse(agentDetailSchema, "Retrieve the agent by ID"),
      401: jsonErrorResponse("Unauthorized"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const [creditCosts, cardanoV2ReadySources] = await Promise.all([
      getCreditCostsOrThrow(),
      getCardanoV2ReadySources(),
    ]);

    // Nested pricing rows must share one snapshot. Credit-cost and Cardano
    // readiness are not that graph; metrics are not either. See
    // AGENT_PRICING_READ_TRANSACTION_OPTIONS.
    const [agent] = await prisma.$transaction(
      [
        prisma.agent.findFirst({
          where: {
            id,
            ...buildAvailableAgentWhereClause(
              creditCosts,
              cardanoV2ReadySources,
            ),
          },
          include: agentDetailInclude,
        }),
      ],
      AGENT_PRICING_READ_TRANSACTION_OPTIONS,
    );

    if (!agent) {
      throw notFound("Agent not found");
    }

    const cost = getAgentCost(agent, creditCosts);

    const agentWithDetails = {
      ...agent,
      credits: convertCentsToCredits(cost.cents),
      name: getAgentName(agent),
      image: getAgentImage(agent),
      icon: getAgentIcon(agent),
      description: getAgentDescription(agent),
      author: getAuthorFromAgent(agent),
      legal: getAgentLegalFromAgent(agent),
      categories: (agent.categories ?? []).map(mapCategoryForApi),
      riskClassification: agent.riskClassification,
      tags: getAgentTagsFromAgent(agent),
      exampleOutputs: getAgentExampleOutputsFromAgent(agent),
    };

    const [averageExecutionTime, ratingMetrics] = await Promise.all([
      calculateAverageExecutionTime(id, prisma),
      calculateAgentRating(id, prisma),
    ]);

    return ok(
      c,
      agentDetailSchema.parse({
        ...agentWithDetails,
        metrics: {
          executions: {
            count: agent.jobCount,
            averageTime: averageExecutionTime ?? null,
          },
          ratings: ratingMetrics,
        },
      }),
    );
  });
}
