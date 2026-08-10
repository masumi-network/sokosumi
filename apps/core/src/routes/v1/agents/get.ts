import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  agentMetadataOverrideScalarsInclude,
  agentOrderBy,
  agentPricingInclude,
  type Prisma,
} from "@sokosumi/database";
import {
  AGENT_PRICING_READ_TRANSACTION_OPTIONS,
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
import { agentCategoriesInclude } from "@/types/agent";

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

    // Credit costs and V2 readiness are independent single-row reads that no
    // sync rewrites mid-request, so they need no shared snapshot and run
    // concurrently. The agent page below is a different matter — see there.
    const [creditCosts, cardanoV2ReadySources] = await Promise.all([
      getCreditCostsOrThrow(prisma),
      getCardanoV2ReadySources(prisma),
    ]);
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
    // One snapshot for the whole page. Prisma loads `include`d relations as
    // SEPARATE statements (Agent, then AgentPricing, then AgentFixedPricing,
    // then UnitValue), and at READ COMMITTED each takes its own snapshot. A
    // registry replay committing between two of them leaves this read holding
    // an AgentFixedPricing id whose amount rows are already gone — FIXED
    // pricing with no amounts, which prices as zero.
    //
    // This is the BATCH form, not the interactive one: no application code
    // runs inside it, so it does not hold a pool connection across awaits
    // (#2559 / P2028). Read-only REPEATABLE READ cannot raise a serialization
    // failure, so it adds no error path.
    const [agents, count] = await prisma.$transaction(
      [
        prisma.agent.findMany({
          where,
          take: takePlusOne,
          skip,
          cursor: cursor ? { id: cursor } : undefined,
          orderBy: [...agentOrderBy, { id: "desc" }],
          include: {
            ...agentPricingInclude,
            ...agentCategoriesInclude,
            ...agentMetadataOverrideScalarsInclude,
          },
        }),
        prisma.agent.count({ where }),
      ],
      AGENT_PRICING_READ_TRANSACTION_OPTIONS,
    );

    // Paginate from the RAW rows, not the summaries: buildAgentSummaries can
    // skip a row (transient pricing rewrite), and cursoring off the filtered
    // list would leave the cursor parked on the skipped agent forever.
    const paginationRows = agents.slice(0, take);
    const agentsWithMetrics = await buildAgentSummaries(
      paginationRows,
      creditCosts,
      prisma,
    );

    const paginationMeta = createPaginationMeta(
      paginationRows,
      count,
      take,
      agents.length === takePlusOne,
      cursor,
    );

    return ok(c, agentsSummarySchema.parse(agentsWithMetrics), paginationMeta);
  });
}
