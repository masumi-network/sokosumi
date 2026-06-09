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
import { requireWorkspaceContext } from "@/middleware/workspace";
import { agentsSummarySchema } from "@/schemas/agent.schema";
import {
  agentCategoriesInclude,
  agentJobsCountInclude,
  agentPricingInclude,
} from "@/types/agent";

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/hired",
    description:
      "List agents the authenticated caller has run jobs with in the active workspace, ordered by most recent job activity",
    tags: ["Agents"],
    responses: {
      200: jsonSuccessResponse(
        agentsSummarySchema,
        "Retrieve the caller's hired agents",
      ),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const workspaceContext = requireWorkspaceContext(c.var.workspaceContext);

    const agents = await prisma.$transaction(async (tx) => {
      const creditCosts = await getCreditCostsOrThrow(tx);

      const jobWhere: Prisma.JobWhereInput = {
        workspaceId: workspaceContext.workspaceId,
        ...(workspaceContext.userId ? { userId: workspaceContext.userId } : {}),
      };

      const rows = await tx.agent.findMany({
        where: {
          AND: [
            buildAvailableAgentWhereClause(creditCosts),
            { jobs: { some: jobWhere } },
          ],
        },
        include: {
          ...agentPricingInclude,
          ...agentJobsCountInclude,
          ...agentCategoriesInclude,
          jobs: {
            where: jobWhere,
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
        },
      });

      // Order by latest job activity (newest first). Agents are guaranteed to
      // have at least one matching job by the `some` filter above.
      const orderedRows = [...rows].sort((a, b) => {
        const aLatest = a.jobs[0]?.createdAt?.getTime() ?? 0;
        const bLatest = b.jobs[0]?.createdAt?.getTime() ?? 0;
        return bLatest - aLatest;
      });

      return await buildAgentSummaries(orderedRows, creditCosts, tx);
    });

    return ok(c, agentsSummarySchema.parse(agents));
  });
}
