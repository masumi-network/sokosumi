import type { GalleryFilterState } from "@/hooks/use-gallery-filter";
import type { CatalogBrowseAgent } from "@/lib/agents/catalog-browse-agent";
import { SPECIAL_AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";

export const filterAgents = (
  agents: CatalogBrowseAgent[],
  { query, categories, kind }: GalleryFilterState,
) => {
  const normalizedQuery = query.toLowerCase().trim();
  const categoriesInScope = kind === "x402" ? [] : categories;

  if (!normalizedQuery && categoriesInScope.length === 0 && kind === "all") {
    return agents;
  }

  return agents.filter((agent) => {
    const matchesKind =
      kind === "all" ||
      (kind === "cardano" && agent.kind === "cardano") ||
      (kind === "x402" && agent.kind === "x402");

    const matchesQuery =
      !normalizedQuery ||
      [agent.name, agent.description ?? "", agent.summary ?? ""].some((text) =>
        text.toLowerCase().includes(normalizedQuery),
      );

    const agentCategorySlugs = agent.categories.map(
      (category) => category.slug,
    );

    const effectiveCategorySlugs =
      agentCategorySlugs.length === 0
        ? [SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT]
        : agentCategorySlugs;

    const matchesCategories =
      categoriesInScope.length === 0 ||
      categoriesInScope.some((slug) => effectiveCategorySlugs.includes(slug));

    return matchesKind && matchesQuery && matchesCategories;
  });
};
