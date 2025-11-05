import type { AgentWithCreditsPrice } from "@sokosumi/database";

import { getAgentCategories } from "@/lib/helpers/agent";
import type { Category } from "@/lib/types/category";

export interface AgentCategoryGroup {
  categorySlug: string | null;
  categoryName: string;
  agents: AgentWithCreditsPrice[];
}

export function groupAgentsByCategory(
  agents: AgentWithCreditsPrice[],
  categories: Category[],
): AgentCategoryGroup[] {
  const sortedCategories = new Map(
    categories.map((cat) => [cat.slug, cat.name]),
  );

  const groupsBySlug = new Map<string, AgentWithCreditsPrice[]>();
  const categorySlugs = new Set(sortedCategories.keys());

  for (const agent of agents) {
    // Convert to Set once per agent for O(1) lookups
    const agentCategoriesSet = new Set(getAgentCategories(agent));

    // Assign to all matching database categories
    for (const slug of categorySlugs) {
      if (agentCategoriesSet.has(slug)) {
        if (!groupsBySlug.has(slug)) {
          groupsBySlug.set(slug, []);
        }
        groupsBySlug.get(slug)!.push(agent);
      }
    }
  }

  // Return categories in priority order, only including those with agents
  return Array.from(sortedCategories.keys())
    .filter((slug) => groupsBySlug.has(slug))
    .map((slug) => ({
      categorySlug: slug,
      categoryName: sortedCategories.get(slug) ?? slug,
      agents: groupsBySlug.get(slug)!,
    }));
}
