import { createRoute, z } from "@hono/zod-openapi";
import { convertCentsToCredits } from "@sokosumi/utils";

import {
  calculateAverageExecutionTime,
  getAgentDescription,
  getAgentIcon,
  getAgentImage,
  getAgentName,
} from "@/helpers/agent";
import { calculateAgentRating } from "@/helpers/agent-rating";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { getAvailableAgent } from "@/lib/agent-catalog/detail";
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

    const scope = c.var.networkScope;
    const available = await getAvailableAgent(scope, id);
    if (!available) throw notFound("Agent not found");
    const { agent, cost } = available;

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
      calculateAverageExecutionTime(id, scope),
      calculateAgentRating(id, scope.networkDb),
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
