import type { AgentWithCreditsPrice } from "@sokosumi/database";

import { SPECIAL_AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";
import { getAgentCategorySlugs } from "@/lib/helpers/agent";
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
    const agentCategorySlugsSet = new Set(getAgentCategorySlugs(agent));

    // If agent has no categories, assign to synthetic default (Others)
    if (agentCategorySlugsSet.size === 0) {
      const defaultGroup = groupsBySlug.get(
        SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT,
      );
      if (defaultGroup) {
        defaultGroup.push(agent);
      } else {
        groupsBySlug.set(SPECIAL_AGENT_CATEGORY_SLUGS.DEFAULT, [agent]);
      }
      continue;
    }

    // Assign to all matching database categories
    for (const slug of categorySlugs) {
      if (agentCategorySlugsSet.has(slug)) {
        const group = groupsBySlug.get(slug);
        if (group) {
          group.push(agent);
        } else {
          groupsBySlug.set(slug, [agent]);
        }
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
