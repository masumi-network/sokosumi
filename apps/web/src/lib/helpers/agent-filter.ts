import type { GalleryFilterState } from "@/hooks/use-gallery-filter";
import { SPECIAL_AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";
import { getAgentCategorySlugs } from "@/lib/helpers/agent";
import type { CoreAgentDto } from "@/lib/types/core-dto";

export const filterAgents = (
  agents: CoreAgentDto[],
  { query, categories }: GalleryFilterState,
) => {
  if (!query && categories.length === 0) {
    return agents;
  }

  const normalizedQuery = query.toLowerCase().trim();

  return agents.filter((agent) => {
    // Query matching
    const matchesQuery =
      !normalizedQuery ||
      [agent.name, agent.description ?? ""].some((text) =>
        text.toLowerCase().includes(normalizedQuery),
      );

    // Category matching - OR logic (agent matches if it has ANY selected category)
    const agentCategorySlugs = getAgentCategorySlugs(agent);

    // Agents without categories are treated as having the synthetic "default" category
    const effectiveCategorySlugs =
      agentCategorySlugs.length === 0
        ? [SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT]
        : agentCategorySlugs;

    const matchesCategories =
      categories.length === 0 ||
      categories.some((slug) => effectiveCategorySlugs.includes(slug));

    return matchesQuery && matchesCategories;
  });
};
