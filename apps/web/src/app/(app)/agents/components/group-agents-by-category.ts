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

/**
 * Groups agents by category in a specific priority order:
 * 1. Featured Agents (featured-agents slug)
 * 2. New Agents (isNew === true)
 * 3. Other Categories (all remaining category slugs)
 * 4. Others (agents with no categories)
 *
 * @param agents - Array of agents to group
 * @param categories - Array of category objects with slug and name
 * @returns Array of grouped agents with category info
 */
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

  const regularCategorySlugs = categories
    .map((cat) => cat.slug)
    .filter(
      (slug) =>
        slug !== AGENT_CATEGORY_SLUGS.FEATURED &&
        slug !== AGENT_CATEGORY_SLUGS.NEW &&
        slug !== AGENT_CATEGORY_SLUGS.OTHERS,
    );

  for (const agent of agents) {
    const agentCategories = getAgentCategories(agent);
    let wasAssigned = false;

    if (agentCategories.includes(AGENT_CATEGORY_SLUGS.FEATURED)) {
      assignAgentToGroup(AGENT_CATEGORY_SLUGS.FEATURED, agent);
      wasAssigned = true;
    }

    if (isAgentNew(agent)) {
      assignAgentToGroup(AGENT_CATEGORY_SLUGS.NEW, agent);
      wasAssigned = true;
    }

    for (const slug of regularCategorySlugs) {
      if (agentCategories.includes(slug)) {
        assignAgentToGroup(slug, agent);
        wasAssigned = true;
      }
    }

    // Only assign to "Others" if agent has no categories and hasn't been assigned elsewhere
    if (!wasAssigned && agentCategories.length === 0) {
      assignAgentToGroup(null, agent);
    }
  }

  const orderedSlugs: Array<string | null> = [
    AGENT_CATEGORY_SLUGS.FEATURED,
    AGENT_CATEGORY_SLUGS.NEW,
    ...regularCategorySlugs,
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
