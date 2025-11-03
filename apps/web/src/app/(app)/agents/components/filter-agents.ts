import type { AgentWithCreditsPrice } from "@sokosumi/database";

import { AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";
import { getAgentCategories } from "@/lib/helpers/agent";
import { isAgentNew } from "@/lib/utils/agent";

import { GalleryFilterState } from "./use-gallery-filter";

export const filterAgents = (
  agents: AgentWithCreditsPrice[],
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

    // Category matching (supports special slugs)
    const agentCategories = getAgentCategories(agent);
    const selected = new Set(categories);
    const realCategorySlugs = categories.filter(
      (s) =>
        s !== AGENT_CATEGORY_SLUGS.NEW && s !== AGENT_CATEGORY_SLUGS.OTHERS,
    );

    const matchesRealCategories =
      realCategorySlugs.length > 0 &&
      realCategorySlugs.some((slug) => agentCategories.includes(slug));

    const isNew = isAgentNew(agent);
    const matchesNew = selected.has(AGENT_CATEGORY_SLUGS.NEW) && isNew;
    const isFeatured = agentCategories.includes(AGENT_CATEGORY_SLUGS.FEATURED);
    const matchesOthers =
      selected.has(AGENT_CATEGORY_SLUGS.OTHERS) &&
      agentCategories.length === 0 &&
      !isNew &&
      !isFeatured;

    const matchesCategories =
      categories.length === 0 ||
      matchesRealCategories ||
      matchesNew ||
      matchesOthers;

    return matchesQuery && matchesCategories;
  });
};
