import { createRoute, z } from "@hono/zod-openapi";
import { convertCentsToCredits } from "@sokosumi/utils";

import {
  AGENT_PRICING_READ_TRANSACTION_OPTIONS,
  buildAvailableAgentWhereClause,
  calculateAgentRating,
  calculateAverageExecutionTime,
  getAgentDescription,
  getAgentIcon,
  getAgentImage,
  getAgentName,
  getCardanoV2ReadySources,
  getCreditCostsOrThrow,
} from "@/helpers/agent";
import { getAgentCost } from "@/helpers/agent-cost";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
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

const route = withGlobalHeaderParameters(
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

    const agent = await prisma.$transaction(async (tx) => {
      const creditCosts = await getCreditCostsOrThrow(tx);
      const cardanoV2ReadySources = await getCardanoV2ReadySources(tx);

      const agent = await tx.agent.findFirst({
        where: {
          id,
          ...buildAvailableAgentWhereClause(creditCosts, cardanoV2ReadySources),
        },
        include: agentDetailInclude,
      });

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

      const averageExecutionTime = await calculateAverageExecutionTime(id, tx);
      const executionMetrics = {
        count: agent.jobCount,
        averageTime: averageExecutionTime ?? null,
      };

      const ratingMetrics = await calculateAgentRating(id, tx);

      return {
        ...agentWithDetails,
        metrics: {
          executions: executionMetrics,
          ratings: ratingMetrics,
        },
      };
    }, AGENT_PRICING_READ_TRANSACTION_OPTIONS);
    return ok(c, agentDetailSchema.parse(agent));
  });
}
