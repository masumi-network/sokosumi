import type { CatalogBrowseAgent } from "@/lib/agents/catalog-browse-agent";
import { SPECIAL_AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";
import type { Category } from "@/lib/types/category";

export interface AgentCategoryGroup {
  categorySlug: string | null;
  categoryName: string;
  categoryIcon?: string;
  agents: CatalogBrowseAgent[];
}

export function groupAgentsByCategory(
  agents: CatalogBrowseAgent[],
  categories: Category[],
): AgentCategoryGroup[] {
  const sortedCategories = new Map(
    [...categories]
      .sort((left, right) => left.priority - right.priority)
      .map((cat) => [cat.slug, { name: cat.name, icon: cat.icon }]),
  );

  const groupsBySlug = new Map<string, CatalogBrowseAgent[]>();
  const categorySlugs = new Set(sortedCategories.keys());

  for (const agent of agents) {
    const agentCategorySlugsSet = new Set(
      agent.categories.map((category) => category.slug),
    );

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
