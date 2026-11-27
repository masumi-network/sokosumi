import {
  AgentEntryType,
  agentMetadataOverrideScalarsInclude,
  agentOrderBy,
  agentPricingInclude,
  type Prisma,
} from "@sokosumi/database";
import {
  getAgentDescription,
  getAgentImage,
  getAgentName,
} from "@/helpers/agent";
import { buildAgentSummaries } from "@/helpers/agent-summary";
import { createPaginationMeta } from "@/helpers/pagination";
import {
  buildX402AgentPricingListing,
  type X402AgentPaymentSourceRow,
  type X402ListingDropReason,
} from "@/helpers/x402-agent-listing";
import type { NetworkScope } from "@/lib/db/network-scope";
import type { X402Agent } from "@/schemas/x402-agent.schema";
import { agentCategoriesInclude } from "@/types/agent";
import {
  AGENT_PRICING_READ_TRANSACTION_OPTIONS,
  buildAvailableAgentWhereClause,
  readListingInputs,
} from "./availability";
import { getX402AgentCatalogWhere, hasValidX402DiscoveryUrl } from "./x402";

const UNCATEGORIZED_CATEGORY_FILTER = "uncategorized";
export const AGENT_LIST_KINDS = ["cardano", "x402"] as const;
type AgentListKind = (typeof AGENT_LIST_KINDS)[number];

/** Loaded only when the x402 rail is on the page — hire-only queries skip it. */
const X402_PAYMENT_SOURCES_INCLUDE = {
  paymentSources: {
    where: { scheme: { not: null } },
    select: {
      network: true,
      payTo: true,
      pricingType: true,
      scheme: true,
      amounts: {
        select: { unit: true, amount: true, decimals: true },
        orderBy: [{ unit: "asc" as const }, { id: "asc" as const }],
      },
    },
    orderBy: { sourceIndex: "asc" as const },
  },
};

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

function listedPaymentSources(agent: {
  paymentSources?: readonly {
    network: string;
    payTo: string | null;
    pricingType: X402AgentPaymentSourceRow["pricingType"];
    scheme: string | null;
    amounts?: X402AgentPaymentSourceRow["amounts"];
  }[];
}): readonly X402AgentPaymentSourceRow[] {
  const sources = agent.paymentSources;
  if (!sources) {
    return [];
  }
  const listed: X402AgentPaymentSourceRow[] = [];
  for (const source of sources) {
    if (!source.amounts) {
      return [];
    }
    listed.push({
      network: source.network,
      payTo: source.payTo,
      pricingType: source.pricingType,
      scheme: source.scheme,
      amounts: source.amounts,
    });
  }
  return listed;
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

export async function listAvailableAgents(
  scope: NetworkScope,
  {
    kinds,
    categorySlugs,
    cursor,
    take,
  }: {
    kinds: readonly AgentListKind[];
    categorySlugs?: string[];
    cursor?: string;
    take: number;
  },
) {
  const includeCardano = kinds.includes("cardano");
  const includeX402 = kinds.includes("x402");

  const { creditCosts, cardanoV2ReadySources, readySources, network } =
    await readListingInputs(scope, includeCardano, includeX402);
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
  const [agents, count] = await scope.netBatch(
    (db) => [
      db.agent.findMany({
        where,
        take: takePlusOne,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        orderBy: [...agentOrderBy, { id: "desc" }],
        include: {
          ...agentPricingInclude,
          ...agentCategoriesInclude,
          ...agentMetadataOverrideScalarsInclude,
          ...(includeX402 ? X402_PAYMENT_SOURCES_INCLUDE : {}),
        },
      }),
      db.agent.count({ where }),
    ],
    AGENT_PRICING_READ_TRANSACTION_OPTIONS.isolationLevel,
  );

  const paginationRows = agents.slice(0, take);
  const cardanoRows = includeCardano
    ? paginationRows.filter((agent) => agent.type === AgentEntryType.STANDARD)
    : [];
  const cardanoSummaries = includeCardano
    ? await buildAgentSummaries(cardanoRows, creditCosts, scope.networkDb)
    : [];
  const cardanoById = new Map(
    cardanoSummaries.map((summary) => [summary.id, summary]),
  );

  const items: (
    | X402Agent
    | ((typeof cardanoSummaries)[number] & { kind: "cardano" })
  )[] = [];
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
    const result = buildX402AgentPricingListing(listedPaymentSources(agent), {
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

  return {
    items,
    pagination: createPaginationMeta(
      paginationRows,
      count,
      take,
      agents.length === takePlusOne,
      cursor,
    ),
    listedX402Count,
    dropsByReason,
  };
}
