import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  agentMetadataOverrideScalarsInclude,
  agentOrderBy,
  agentPricingInclude,
  type Prisma,
} from "@sokosumi/database";
import {
  buildAvailableAgentWhereClause,
  getCardanoV2ReadySources,
  getCreditCostsOrThrow,
} from "@/helpers/agent";
import { buildAgentSummaries } from "@/helpers/agent-summary";
import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
} from "@/helpers/openapi";
import {
  createPaginationMeta,
  parseCursorPagination,
} from "@/helpers/pagination";
import {
  deduplicateQueryValues,
  preprocessMultiValueQueryInput,
} from "@/helpers/query-params";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { agentsSummarySchema } from "@/schemas/agent.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import { agentCategoriesInclude, agentJobsCountInclude } from "@/types/agent";

const UNCATEGORIZED_CATEGORY_FILTER = "uncategorized";

function buildCategoryWhereClause(
  categorySlugs: string[] | undefined,
): Prisma.AgentWhereInput | undefined {
  if (!categorySlugs?.length) {
    return undefined;
  }

  const includesUncategorized = categorySlugs.includes(
    UNCATEGORIZED_CATEGORY_FILTER,
  );
  const persistedCategorySlugs = categorySlugs.filter(
    (slug) => slug !== UNCATEGORIZED_CATEGORY_FILTER,
  );

  const filters: Prisma.AgentWhereInput[] = [];

  if (includesUncategorized) {
    filters.push({
      categories: {
        none: {},
      },
    });
  }

  if (persistedCategorySlugs.length > 0) {
    filters.push({
      categories: {
        some: {
          slug: {
            in: persistedCategorySlugs,
          },
        },
      },
    });
  }

  if (filters.length === 0) {
    return undefined;
  }

  return filters.length === 1 ? filters[0] : { OR: filters };
}

const agentsListQuerySchema = cursorPaginationQuerySchema.extend({
  category: z
    .preprocess(
      preprocessMultiValueQueryInput,
      z
        .array(z.string().min(1))
        .min(1)
        .optional()
        .transform(deduplicateQueryValues),
    )
    .openapi({
      param: { name: "category", in: "query" },
      description:
        "Filter by category slug. Supports repeated values and comma-separated lists. The reserved value `uncategorized` matches agents without assigned categories. When multiple categories are provided, agents matching any category are returned.",
      example: "research,uncategorized",
    }),
});

const route = createRoute({
  method: "get",
  path: "/",
  description: "List all available agents (paginated)",
  tags: ["Agents"],
  security: [],
  request: {
    query: agentsListQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(
      agentsSummarySchema,
      "Retrieve all agents",
      {
        data: [],
        meta: {
          timestamp: "2025-01-15T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
          pagination: {
            cursor: null,
            limit: 20,
            total: 100,
            nextCursor: "cmaeygqwa000e8i0s9s7wif8i",
          },
        },
      },
    ),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const { category: categorySlugs } = queryParams;

    const result = await prisma.$transaction(async (tx) => {
      const creditCosts = await getCreditCostsOrThrow(tx);
      const cardanoV2ReadySources = await getCardanoV2ReadySources(tx);
      const baseWhere = buildAvailableAgentWhereClause(
        creditCosts,
        cardanoV2ReadySources,
      );
      const categoryWhere = buildCategoryWhereClause(categorySlugs);
      const where: Prisma.AgentWhereInput = categoryWhere
        ? {
            AND: [baseWhere, categoryWhere],
          }
        : baseWhere;

      const takePlusOne = take + 1;
      const agents = await tx.agent.findMany({
        where,
        take: takePlusOne,
        skip,
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: [...agentOrderBy, { id: "desc" }],
        include: {
          ...agentPricingInclude,
          ...agentJobsCountInclude,
          ...agentCategoriesInclude,
          ...agentMetadataOverrideScalarsInclude,
        },
      });
      const count = await tx.agent.count({ where });

      const agentsWithMetrics = await buildAgentSummaries(
        agents.slice(0, take),
        creditCosts,
        tx,
      );

      return {
        agents: agentsWithMetrics,
        paginationRows: agents.slice(0, take),
        count,
        hasMore: agents.length === takePlusOne,
      };
    });

    const paginationMeta = createPaginationMeta(
      result.paginationRows,
      result.count,
      take,
      result.hasMore,
      cursor,
    );

    return ok(c, agentsSummarySchema.parse(result.agents), paginationMeta);
  });
}
