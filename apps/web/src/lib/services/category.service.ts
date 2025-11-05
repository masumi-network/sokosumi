import "server-only";

import { categoryRepository } from "@sokosumi/database/repositories";

import { SYNTHETIC_DEFAULT_CATEGORY } from "@/lib/constants/agent-categories";
import type { Category } from "@/lib/types/category";

export const categoryService = (() => {
  /**
   * Retrieves categories for the agent gallery page ordered by priority.
   *
   * @returns Promise resolving to sorted array of categories
   */
  async function getValidCategories(): Promise<Category[]> {
    try {
      const categories =
        await categoryRepository.getCategoriesForAvailableAgents();

      const mappedCategories = categories.map(
        (category): Category => ({
          slug: category.slug,
          name: category.name,
          priority: category.priority,
        }),
      );

      return [...mappedCategories, SYNTHETIC_DEFAULT_CATEGORY];
    } catch {
      return [SYNTHETIC_DEFAULT_CATEGORY];
    }
  }

  return {
    getValidCategories,
  };
})();
