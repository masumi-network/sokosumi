import { createRoute, z } from "@hono/zod-openapi";

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
import {
  getAgentExampleOutputsFromAgent,
  getAgentTagsFromAgent,
} from "@/schemas/agent.schema";
import { catalogSchema } from "@/schemas/catalog.schema";
import { agentDetailInclude, agentOrderBy } from "@/types/agent";

const querySchema = z.object({
  coworkerScope: z
    .enum(["all", "whitelisted", "archived"])
    .optional()
    .default("whitelisted")
    .openapi({
      param: { name: "coworkerScope", in: "query" },
      description:
        "Coworker visibility scope. Defaults to 'whitelisted'. Use 'all' to include all active coworkers or 'archived' to include archived coworkers.",
      example: "all",
    }),
});

const route = withGlobalHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description:
      "List all available agents and coworkers with their metadata in a single response.",
    tags: ["Catalog"],
    request: {
      query: querySchema,
    },
    responses: {
      200: jsonSuccessResponse(
        catalogSchema,
        "Retrieve all agents and coworkers",
      ),
      401: jsonErrorResponse("Unauthorized"),
      422: jsonErrorResponse("Unprocessable Entity"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { coworkerScope } = c.req.valid("query");

    const coworkerWhere =
      coworkerScope === "archived"
        ? { archivedAt: { not: null } }
        : {
            archivedAt: null,
            ...(coworkerScope === "whitelisted" ? { isWhitelisted: true } : {}),
          };

    const [agents, coworkers] = await Promise.all([
      prisma.$transaction(async (tx) => {
        const creditCosts = await getCreditCostsOrThrow(tx);
        const rows = await tx.agent.findMany({
          where: buildAvailableAgentWhereClause(creditCosts),
          orderBy: [...agentOrderBy, { id: "desc" }],
          include: agentDetailInclude,
        });

        const rowsById = new Map(rows.map((row) => [row.id, row]));
        const summaries = await buildAgentSummaries(rows, creditCosts, tx);

        return summaries.map((summary) => {
          const row = rowsById.get(summary.id);
          return {
            ...summary,
            tags: row ? getAgentTagsFromAgent(row) : [],
            exampleOutputs: row ? getAgentExampleOutputsFromAgent(row) : [],
          };
        });
      }),
      prisma.coworker.findMany({
        where: coworkerWhere,
        orderBy: [{ priority: "desc" }, { slug: "asc" }],
      }),
    ]);

    return ok(c, catalogSchema.parse({ agents, coworkers }));
  });
}
