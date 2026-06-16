import { SPECIAL_AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";
import { getAgentCategorySlugs } from "@/lib/helpers/agent";
import type { Category } from "@/lib/types/category";
import type { CoreAgentDto } from "@/lib/types/core-dto";

export interface AgentCategoryGroup {
  categorySlug: string | null;
  categoryName: string;
  categoryIcon?: string;
  agents: CoreAgentDto[];
}

export function groupAgentsByCategory(
  agents: CoreAgentDto[],
  categories: Category[],
): AgentCategoryGroup[] {
  const sortedCategories = new Map(
    categories.map((cat) => [cat.slug, { name: cat.name, icon: cat.icon }]),
  );

  const groupsBySlug = new Map<string, CoreAgentDto[]>();
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
    .map((slug) => {
      const category = sortedCategories.get(slug);
      return {
        categorySlug: slug,
        categoryName: category?.name ?? slug,
        categoryIcon: category?.icon,
        agents: groupsBySlug.get(slug)!,
      };
    });
}
