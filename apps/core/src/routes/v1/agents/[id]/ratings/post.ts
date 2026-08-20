import { createRoute, z } from "@hono/zod-openapi";
import { jobRepository } from "@sokosumi/database/repositories";

import { requireAvailableAgentOrThrow } from "@/helpers/agent";
import { upsertUserAgentReview } from "@/helpers/agent-rating";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import { forbidden } from "@/helpers/error";
import { jsonContent, jsonErrorResponse } from "@/helpers/openapi";
import { created, successResponseSchema } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  agentMyReviewSchema,
  agentRatingRequestSchema,
} from "@/schemas/agent.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "cmaeygqwa000e8i0s9s7wif8i",
  }),
});

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "post",
    path: "/{id}/ratings",
    description:
      "Create or update the authenticated caller's rating for an agent. Requires the caller to have finished at least one job with the agent. Session user or orchestrator/coworker with context headers.",
    tags: ["Agents"],
    request: {
      params,
      body: {
        content: {
          "application/json": {
            schema: agentRatingRequestSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: "Rating created or updated",
        content: jsonContent(successResponseSchema(agentMyReviewSchema)),
      },
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = await requireAuthorizedUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { rating, comment } = c.req.valid("json");

    const review = await prisma.$transaction(async (tx) => {
      await requireAvailableAgentOrThrow(id, tx);

      const hasFinishedJob =
        await jobRepository.doesUserHaveFinishedJobWithAgent(
          userContext.userId,
          id,
          tx,
        );

      if (!hasFinishedJob) {
        throw forbidden(
          "You must complete at least one job with this agent before rating",
        );
      }

      return await upsertUserAgentReview(
        id,
        userContext.userId,
        rating,
        comment ?? null,
        tx,
      );
    });

    return created(c, agentMyReviewSchema.parse(review));
  });
}
