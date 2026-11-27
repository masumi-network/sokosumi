import { createRoute, z } from "@hono/zod-openapi";

import {
  getAgentRatingDistribution,
  getRecentAgentReviews,
} from "@/helpers/agent-rating";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { requireAvailableAgent } from "@/lib/agent-catalog/availability";
import {
  type OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { agentReviewsSchema } from "@/schemas/agent.schema";

const RECENT_REVIEW_LIMIT = 10;

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i",
  }),
});

const query = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(RECENT_REVIEW_LIMIT)
    .openapi({
      param: { name: "limit", in: "query" },
      description: "Maximum number of commented reviews to return",
      example: RECENT_REVIEW_LIMIT,
    }),
});

const route = withOrganizationSlugHeaderParameter(
  createRoute({
    method: "get",
    path: "/{id}/reviews",
    description: "Get public review details for an agent",
    tags: ["Agents"],
    request: {
      params,
      query,
    },
    responses: {
      200: jsonSuccessResponse(
        agentReviewsSchema,
        "Retrieve public reviews for the agent by ID",
      ),
      401: jsonErrorResponse("Unauthorized"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const { limit } = c.req.valid("query");

    const scope = c.var.networkScope;
    await requireAvailableAgent(scope, id);

    const [distribution, ratingsWithComments] = await Promise.all([
      getAgentRatingDistribution(id, scope.networkDb),
      getRecentAgentReviews(id, limit, scope),
    ]);

    const reviews = {
      distribution,
      ratingsWithComments,
    };

    return ok(c, agentReviewsSchema.parse(reviews));
  });
}
