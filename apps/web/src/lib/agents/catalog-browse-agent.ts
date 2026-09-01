import type {
  AgentListItem,
  Category as CoreCategory,
} from "@/lib/clients/generated/core";

/**
 * Gallery presentation shape for catalog browse (Cardano + x402 list items).
 * Keeps card/filter/group helpers on one seam without forcing CoreAgentDto.
 */
export interface CatalogBrowseAgent {
  id: string;
  kind: "cardano" | "x402";
  name: string;
  description: string | null;
  summary: string | null;
  image: string | null;
  icon: string | null;
  categories: CoreCategory[];
  metrics: {
    executions: { count: number; averageTime: number | null };
    ratings: { total: number; average: number | null };
  };
  author: {
    name: string | null;
    image: string | null;
    organization: string | null;
    other: string | null;
  };
  /** Prefer Bazaar resources URL; fall back to OpenAPI spec for x402. */
  externalUrl: string | null;
}

const EMPTY_METRICS: CatalogBrowseAgent["metrics"] = {
  executions: { count: 0, averageTime: null },
  ratings: { total: 0, average: null },
};

const EMPTY_AUTHOR: CatalogBrowseAgent["author"] = {
  name: null,
  image: null,
  organization: null,
  other: null,
};

export function mapAgentListItemToCatalogBrowseAgent(
  item: AgentListItem,
): CatalogBrowseAgent {
  if (item.kind === "cardano") {
    return {
      id: item.id,
      kind: "cardano",
      name: item.name,
      description: item.description,
      summary: item.summary,
      image: item.image,
      icon: item.icon,
      categories: item.categories,
      metrics: item.metrics,
      author: {
        name: item.author.name,
        image: item.author.image,
        organization: item.author.organization,
        other: item.author.other,
      },
      externalUrl: null,
    };
  }

  return {
    id: item.id,
    kind: "x402",
    name: item.name,
    description: item.description,
    summary: null,
    image: item.image,
    icon: null,
    categories: [],
    metrics: EMPTY_METRICS,
    author: EMPTY_AUTHOR,
    externalUrl: item.x402ResourcesUrl ?? item.openApiSpecUrl ?? null,
  };
}
