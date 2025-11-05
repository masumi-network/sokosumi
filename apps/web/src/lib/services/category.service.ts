import "server-only";

import { categoryRepository } from "@sokosumi/database/repositories";

import type { Category } from "@/lib/types/category";

export const categoryService = (() => {
  /**
   * Retrieves categories for the agent gallery page ordered by priority.
   *
   * @returns Promise resolving to sorted array of categories
   */
  async function getCategoriesWithAgents(): Promise<Category[]> {
    const categories = await categoryRepository.getCategoriesWithAgents();

    return categories.map(
      (category) =>
        ({
          slug: category.slug,
          name: category.name,
          priority: category.priority,
        }) as Category,
    );
  }

  return {
    getCategoriesWithAgents,
  };
})();
