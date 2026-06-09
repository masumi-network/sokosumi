import { createRoute } from "@hono/zod-openapi";
import type { Prisma } from "@sokosumi/database";
import {
  buildAvailableAgentWhereClause,
  getCreditCostsOrThrow,
} from "@/helpers/agent";
import { buildAgentSummaries } from "@/helpers/agent-summary";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import {
  type OpenAPIHonoWithAuth,
  withGlobalHeaderParameters,
} from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { agentsSummarySchema } from "@/schemas/agent.schema";
import {
  agentCategoriesInclude,
  agentJobsCountInclude,
  agentOrderBy,
  agentPricingInclude,
} from "@/types/agent";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/favorites",
    description:
      "List the authenticated caller's favorite agents (availability-filtered, same shape as the agent catalog)",
    tags: ["Agents"],
    responses: {
      200: jsonSuccessResponse(
        agentsSummarySchema,
        "Retrieve the caller's favorite agents",
      ),
      401: jsonErrorResponse("Unauthorized"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);

    const agents = await prisma.$transaction(async (tx) => {
      const creditCosts = await getCreditCostsOrThrow(tx);
      const favoriteWhere: Prisma.AgentWhereInput = {
        AND: [
          buildAvailableAgentWhereClause(creditCosts),
          {
            agentLists: {
              some: {
                userId: userContext.userId,
                type: "FAVORITE",
              },
            },
          },
        ],
      };

      const rows = await tx.agent.findMany({
        where: favoriteWhere,
        orderBy: [...agentOrderBy, { id: "desc" }],
        include: {
          ...agentPricingInclude,
          ...agentJobsCountInclude,
          ...agentCategoriesInclude,
        },
      });

      return await buildAgentSummaries(rows, creditCosts, tx);
    });

    return ok(c, agentsSummarySchema.parse(agents));
  });
}
