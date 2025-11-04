import type { AgentWithCreditsPrice } from "@sokosumi/database";

import { AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";
import { getAgentCategories } from "@/lib/helpers/agent";
import type { Category } from "@/lib/types/category";
import { isAgentNew } from "@/lib/utils/agent";

export interface AgentCategoryGroup {
  categorySlug: string | null;
  categoryName: string;
  agents: AgentWithCreditsPrice[];
}

export function groupAgentsByCategory(
  agents: AgentWithCreditsPrice[],
  categories: Category[],
): AgentCategoryGroup[] {
  const categoryMap = new Map<string, string>(
    categories.map((cat) => [cat.slug, cat.name]),
  );

  const groupsBySlug = new Map<string | null, AgentWithCreditsPrice[]>();

  const ensureGroup = (slug: string | null) => {
    if (!groupsBySlug.has(slug)) {
      groupsBySlug.set(slug, []);
    }
    return groupsBySlug.get(slug)!;
  };

  const assignAgentToGroup = (
    slug: string | null,
    agent: AgentWithCreditsPrice,
  ) => {
    ensureGroup(slug).push(agent);
  };

  const regularCategorySlugs = new Set(
    categories
      .map((cat) => cat.slug)
      .filter(
        (slug) =>
          slug !== AGENT_CATEGORY_SLUGS.FEATURED &&
          slug !== AGENT_CATEGORY_SLUGS.NEW &&
          slug !== AGENT_CATEGORY_SLUGS.OTHERS,
      ),
  );

  for (const agent of agents) {
    // Convert to Set once per agent for O(1) lookups
    const agentCategoriesSet = new Set(getAgentCategories(agent));
    let wasAssigned = false;

    if (agentCategoriesSet.has(AGENT_CATEGORY_SLUGS.FEATURED)) {
      assignAgentToGroup(AGENT_CATEGORY_SLUGS.FEATURED, agent);
      wasAssigned = true;
    }

    if (isAgentNew(agent)) {
      assignAgentToGroup(AGENT_CATEGORY_SLUGS.NEW, agent);
      wasAssigned = true;
    }

    for (const slug of regularCategorySlugs) {
      if (agentCategoriesSet.has(slug)) {
        assignAgentToGroup(slug, agent);
        wasAssigned = true;
      }
    }

    // Only assign to "Others" if agent has no categories and hasn't been assigned elsewhere
    if (!wasAssigned && agentCategoriesSet.size === 0) {
      assignAgentToGroup(null, agent);
    }
  }

  const orderedSlugs: Array<string | null> = [
    AGENT_CATEGORY_SLUGS.FEATURED,
    AGENT_CATEGORY_SLUGS.NEW,
    ...Array.from(regularCategorySlugs),
    null,
  ];

  return orderedSlugs
    .filter((slug) => groupsBySlug.has(slug))
    .map((slug) => ({
      categorySlug: slug,
      categoryName:
        slug === null
          ? (categoryMap.get(AGENT_CATEGORY_SLUGS.OTHERS) ??
            AGENT_CATEGORY_SLUGS.OTHERS)
          : (categoryMap.get(slug) ?? slug),
      agents: groupsBySlug.get(slug)!,
    }));
}
