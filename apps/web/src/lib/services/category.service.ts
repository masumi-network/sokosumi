import "server-only";

import {
  agentRepository,
  categoryRepository,
} from "@sokosumi/database/repositories";

import { AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";
import type { Category } from "@/lib/types/category";

export const categoryService = (() => {
  /**
   * Retrieves categories for the agent gallery page with proper priority sorting.
   * Includes the "Others" category if there are agents without categories.
   *
   * Priority order:
   * 1. Featured (priority 0)
   * 2. New (priority 1)
   * 3. Regular categories (priority 3)
   * 4. Others (priority 100)
   *
   * @param othersLabel - Translated label for the "Others" category
   * @returns Promise resolving to sorted array of categories
   */
  async function getValidCategories(othersLabel: string): Promise<Category[]> {
    const [categories, hasUncategorizedAgents] = await Promise.all([
      categoryRepository.getCategories(),
      agentRepository.hasAgentsWithoutCategories(),
    ]);

    const categoryPriority: Record<string, number> = {
      [AGENT_CATEGORY_SLUGS.FEATURED]: 0,
      [AGENT_CATEGORY_SLUGS.NEW]: 1,
      [AGENT_CATEGORY_SLUGS.OTHERS]: 100,
    };

    const categoryMap: Category[] = [
      ...categories.map((category) => ({
        slug: category.slug,
        name: category.name,
      })),
      ...(hasUncategorizedAgents
        ? [
            {
              slug: AGENT_CATEGORY_SLUGS.OTHERS,
              name: othersLabel,
            },
          ]
        : []),
    ].sort((a, b) => {
      const priorityA = categoryPriority[a.slug] ?? 3;
      const priorityB = categoryPriority[b.slug] ?? 3;
      return priorityA - priorityB;
    });

    return categoryMap;
  }

  return {
    getValidCategories,
  };
})();
