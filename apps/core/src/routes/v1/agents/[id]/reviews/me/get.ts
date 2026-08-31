import { createRoute, z } from "@hono/zod-openapi";

import {
  buildAvailableAgentWhereClause,
  getCardanoV2ReadySources,
  getCreditCostsOrThrow,
} from "@/helpers/agent";
import { getUserAgentReview } from "@/helpers/agent-rating";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { agentMyReviewResponseSchema } from "@/schemas/agent.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i",
  }),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/{id}/reviews/me",
    description:
      "Get the authenticated caller's own review for an agent. Session user or coworker with authorized context headers.",
    tags: ["Agents"],
    request: {
      params,
    },
    responses: {
      200: jsonSuccessResponse(
        agentMyReviewResponseSchema,
        "The caller's own review for the agent, or null if they have not rated it",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = await requireAuthorizedUserContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const review = await prisma.$transaction(async (tx) => {
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

      return await getUserAgentReview(id, userContext.userId, tx);
    });

    return ok(c, agentMyReviewResponseSchema.parse(review));
  });
}
