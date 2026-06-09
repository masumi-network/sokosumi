import { createRoute } from "@hono/zod-openapi";

import {
  addAgentToFavorites,
  buildAvailableAgentWhereClause,
  getCreditCostsOrThrow,
} from "@/helpers/agent";
import { notFound } from "@/helpers/error";
import { jsonContent, jsonErrorResponse } from "@/helpers/openapi";
import { created, successResponseSchema } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import {
  agentFavoriteRequestSchema,
  agentFavoriteSchema,
} from "@/schemas/agent.schema";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "post",
    path: "/favorites",
    description: "Add an agent to the authenticated caller's favorites",
    tags: ["Agents"],
    request: {
      body: {
        content: {
          "application/json": {
            schema: agentFavoriteRequestSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: "Agent added to favorites",
        content: jsonContent(successResponseSchema(agentFavoriteSchema)),
      },
      401: jsonErrorResponse("Unauthorized"),
      404: jsonErrorResponse("Not Found"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { agentId } = c.req.valid("json");

    await prisma.$transaction(async (tx) => {
      const creditCosts = await getCreditCostsOrThrow(tx);

      const agent = await tx.agent.findFirst({
        where: {
          id: agentId,
          ...buildAvailableAgentWhereClause(creditCosts),
        },
        select: { id: true },
      });

      if (!agent) {
        throw notFound("Agent not found");
      }

      await addAgentToFavorites(userContext.userId, agentId, tx);
    });

    return created(c, agentFavoriteSchema.parse({ agentId }));
  });
}
