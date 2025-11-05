import type { AgentWithCreditsPrice } from "@sokosumi/database";

import { getAgentCategories } from "@/lib/helpers/agent";

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

    // Category matching - OR logic (agent matches if it has ANY selected category)
    const agentCategories = getAgentCategories(agent);

    const matchesCategories =
      categories.length === 0 ||
      categories.some((slug) => agentCategories.includes(slug));

    return matchesQuery && matchesCategories;
  });
};
