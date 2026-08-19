import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  AgentEntryType,
  agentMetadataOverrideScalarsInclude,
  agentOrderBy,
  agentPricingInclude,
  type Prisma,
} from "@sokosumi/database";

import { LIMITS } from "@/config/constants";
import { getEnv } from "@/config/env";
import {
  AGENT_PRICING_READ_TRANSACTION_OPTIONS,
  buildAvailableAgentWhereClause,
  getAgentDescription,
  getAgentImage,
  getAgentName,
  getCardanoV2ReadySources,
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
import {
  buildX402AgentPricingListing,
  type X402ListingDropReason,
} from "@/helpers/x402-agent-listing";
import {
  getX402AgentCatalogWhere,
  getX402ReadySources,
  hasValidX402DiscoveryUrl,
} from "@/helpers/x402-readiness";
import prisma from "@/lib/db/prisma";
import { agentListSchema } from "@/schemas/agent.schema";
import { cursorPaginationQuerySchema } from "@/schemas/pagination.schema";
import type { X402Agent } from "@/schemas/x402-agent.schema";
import { agentCategoriesInclude } from "@/types/agent";

const UNCATEGORIZED_CATEGORY_FILTER = "uncategorized";
const AGENT_LIST_KINDS = ["cardano", "x402"] as const;

type AgentListKind = (typeof AGENT_LIST_KINDS)[number];

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

function logX402ListingDrops(
  listedCount: number,
  dropsByReason: ReadonlyMap<X402ListingDropReason, number>,
  isUnfilteredFirstPage: boolean,
  hasMore: boolean,
): void {
  if (dropsByReason.size === 0) {
    return;
  }
  const summary = JSON.stringify(Object.fromEntries(dropsByReason));
  if (listedCount === 0 && isUnfilteredFirstPage && !hasMore) {
    console.warn(
      `[agents] every x402 candidate agent was dropped as unpayable: ${summary}`,
    );
    return;
  }
  console.debug(`[agents] non-payable x402 agents by reason: ${summary}`);
}

function toX402ListItem(
  agent: {
    id: string;
    type: string;
    x402ResourcesUrl: string | null;
    openApiSpecUrl: string | null;
    name: string;
    description: string | null;
    image: string | null;
    metadataOverride?: {
      name: string | null;
      description: string | null;
      image: string | null;
    } | null;
  },
  result: Extract<
    ReturnType<typeof buildX402AgentPricingListing>,
    { status: "listed" }
  >,
): X402Agent {
  const discovery =
    agent.type === AgentEntryType.OPEN_API
      ? {
          specification: "openapi" as const,
          x402ResourcesUrl: null,
          openApiSpecUrl: agent.openApiSpecUrl,
        }
      : {
          specification: "bazaar" as const,
          x402ResourcesUrl: agent.x402ResourcesUrl,
          openApiSpecUrl: null,
        };
  const base = {
    kind: "x402" as const,
    id: agent.id,
    ...discovery,
    name: getAgentName(agent),
    description: getAgentDescription(agent),
    image: getAgentImage(agent),
  };
  if (result.pricingType === "fixed") {
    return {
      ...base,
      pricingType: "fixed",
      isPayable: true,
      paymentSources: result.paymentSources,
    };
  }
  if (result.pricingType === "dynamic") {
    return {
      ...base,
      pricingType: "dynamic",
      isPayable: result.isPayable,
      paymentSources: result.paymentSources,
    };
  }
  return {
    ...base,
    pricingType: "mixed",
    isPayable: result.isPayable,
    paymentSources: result.paymentSources,
  };
}

const agentsListQuerySchema = cursorPaginationQuerySchema
  .extend({
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
          "Filter Cardano-rail agents by category slug. Supports repeated values and comma-separated lists. The reserved value `uncategorized` matches agents without assigned categories. When multiple categories are provided, agents matching any category are returned. Rejected when `kind` is only `x402`.",
        example: "research,uncategorized",
      }),
    kind: z
      .preprocess(
        preprocessMultiValueQueryInput,
        z
          .array(z.enum(AGENT_LIST_KINDS))
          .min(1)
          .optional()
          .transform(deduplicateQueryValues),
      )
      .openapi({
        param: { name: "kind", in: "query" },
        description:
          "Rail to list. `cardano` is the MIP-003 hire catalog; `x402` is the EVM pay catalog. Omit to return both. Supports repeated values and comma-separated lists.",
        example: "cardano,x402",
      }),
  })
  .superRefine((value, ctx) => {
    const kinds = value.kind ?? [...AGENT_LIST_KINDS];
    const x402Only = kinds.length === 1 && kinds[0] === "x402";
    if (x402Only && value.category?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["category"],
        message: "category cannot be combined with kind=x402",
      });
    }
  });

const route = createRoute({
  method: "get",
  path: "/",
  description:
    "List available agents (paginated). Items are discriminated by `kind`: `cardano` (MIP-003 hire) or `x402` (EVM pay). Omit `kind` to return both rails. Public. x402 filtering runs after candidate pagination, so a page can contain fewer items than `limit` while `nextCursor` still points at more.",
  tags: ["Agents"],
  security: [],
  request: {
    query: agentsListQuerySchema,
  },
  responses: {
    200: jsonPaginatedSuccessResponse(agentListSchema, "Retrieve all agents", {
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
    }),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHono) {
  app.openapi(route, async (c) => {
    const queryParams = c.req.valid("query");
    const { cursor, take, skip } = parseCursorPagination(queryParams);
    const { category: categorySlugs } = queryParams;
    const kinds: AgentListKind[] = queryParams.kind ?? [...AGENT_LIST_KINDS];
    const includeCardano = kinds.includes("cardano");
    const includeX402 = kinds.includes("x402");

    const [creditCosts, cardanoV2ReadySources, readySources] =
      await Promise.all([
        prisma.creditCost.findMany(),
        includeCardano ? getCardanoV2ReadySources(prisma) : Promise.resolve([]),
        includeX402 ? getX402ReadySources(prisma) : Promise.resolve([]),
      ]);
    const network = getEnv().NETWORK;

    const clauses: Prisma.AgentWhereInput[] = [];
    if (includeCardano) {
      const cardanoWhere = buildAvailableAgentWhereClause(
        creditCosts,
        cardanoV2ReadySources,
      );
      const categoryWhere = buildCategoryWhereClause(categorySlugs);
      clauses.push(
        categoryWhere ? { AND: [cardanoWhere, categoryWhere] } : cardanoWhere,
      );
    }
    if (includeX402) {
      clauses.push(getX402AgentCatalogWhere(network));
    }
    const where: Prisma.AgentWhereInput =
      clauses.length === 1 ? clauses[0] : { OR: clauses };

    const takePlusOne = take + 1;
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
            paymentSources: {
              where: { scheme: { not: null } },
              select: {
                network: true,
                payTo: true,
                pricingType: true,
                scheme: true,
                amounts: {
                  select: { unit: true, amount: true, decimals: true },
                  orderBy: [{ unit: "asc" }, { id: "asc" }],
                },
              },
              orderBy: { sourceIndex: "asc" },
            },
          },
        }),
        prisma.agent.count({ where }),
      ],
      AGENT_PRICING_READ_TRANSACTION_OPTIONS,
    );

    const paginationRows = agents.slice(0, take);
    const cardanoRows = includeCardano
      ? paginationRows.filter((agent) => agent.type === AgentEntryType.STANDARD)
      : [];
    const cardanoSummaries = includeCardano
      ? await buildAgentSummaries(cardanoRows, creditCosts, prisma)
      : [];
    const cardanoById = new Map(
      cardanoSummaries.map((summary) => [summary.id, summary]),
    );

    const items: unknown[] = [];
    const dropsByReason = new Map<X402ListingDropReason, number>();
    let listedX402Count = 0;

    for (const agent of paginationRows) {
      if (agent.type === AgentEntryType.STANDARD) {
        const summary = cardanoById.get(agent.id);
        if (summary) {
          items.push({ kind: "cardano", ...summary });
        }
        continue;
      }

      if (!includeX402) {
        continue;
      }

      if (!hasValidX402DiscoveryUrl(agent)) {
        dropsByReason.set(
          "invalid_discovery_url",
          (dropsByReason.get("invalid_discovery_url") ?? 0) + 1,
        );
        continue;
      }
      const result = buildX402AgentPricingListing(agent.paymentSources, {
        creditCosts,
        readySources,
        network,
      });
      if (result.status === "dropped") {
        dropsByReason.set(
          result.reason,
          (dropsByReason.get(result.reason) ?? 0) + 1,
        );
        continue;
      }
      if (result.pricingType !== "fixed" && result.hasUnpricedReadyPair) {
        dropsByReason.set(
          "unpriced_dynamic_preview",
          (dropsByReason.get("unpriced_dynamic_preview") ?? 0) + 1,
        );
      }
      items.push(toX402ListItem(agent, result));
      listedX402Count += 1;
    }

    const isUnfilteredFirstPage =
      !cursor && take === LIMITS.DEFAULT_PAGINATION_LIMIT && !categorySlugs;
    const hasMore = agents.length === takePlusOne;
    if (includeX402) {
      logX402ListingDrops(
        listedX402Count,
        dropsByReason,
        isUnfilteredFirstPage,
        hasMore,
      );
    }

    return ok(
      c,
      agentListSchema.parse(items),
      createPaginationMeta(paginationRows, count, take, hasMore, cursor),
    );
  });
}
