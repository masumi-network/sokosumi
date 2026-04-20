import { createRoute, z } from "@hono/zod-openapi";

import {
  buildAvailableAgentWhereClause,
  getAgentRatingDistribution,
  getCreditCostsOrThrow,
  getRecentAgentReviews,
} from "@/helpers/agent";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { agentReviewsSchema } from "@/schemas/agent.schema";

const RECENT_REVIEW_LIMIT = 10;

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i",
  }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/reviews",
    description: "Get public review details for an agent",
    tags: ["Agents"],
    request: {
      params,
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

    const reviews = await prisma.$transaction(async (tx) => {
      const creditCosts = await getCreditCostsOrThrow(tx);

      const agent = await tx.agent.findFirst({
        where: {
          id,
          ...buildAvailableAgentWhereClause(creditCosts),
        },
        select: {
          id: true,
        },
      });

      if (!agent) {
        throw notFound("Agent not found");
      }

      const [distribution, ratingsWithComments] = await Promise.all([
        getAgentRatingDistribution(id, tx),
        getRecentAgentReviews(id, RECENT_REVIEW_LIMIT, tx),
      ]);

      return {
        distribution,
        ratingsWithComments,
      };
    });

    return ok(c, agentReviewsSchema.parse(reviews));
  });
}
