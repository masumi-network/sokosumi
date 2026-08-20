import { createRoute, z } from "@hono/zod-openapi";

import {
  buildAvailableAgentWhereClause,
  getCardanoV2ReadySources,
  getCreditCostsOrThrow,
} from "@/helpers/agent";
import {
  getAgentRatingDistribution,
  getRecentAgentReviews,
} from "@/helpers/agent-rating";
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
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .openapi({
      param: { name: "offset", in: "query" },
      description: "Number of commented reviews to skip",
      example: 0,
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
    const { limit, offset } = c.req.valid("query");

    const reviews = await prisma.$transaction(async (tx) => {
      const creditCosts = await getCreditCostsOrThrow(tx);
      const cardanoV2ReadySources = await getCardanoV2ReadySources(tx);

      const agent = await tx.agent.findFirst({
        where: {
          id,
          ...buildAvailableAgentWhereClause(creditCosts, cardanoV2ReadySources),
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
        getRecentAgentReviews(id, limit, tx, offset),
      ]);

      return {
        distribution,
        ratingsWithComments,
      };
    });

    return ok(c, agentReviewsSchema.parse(reviews));
  });
}
