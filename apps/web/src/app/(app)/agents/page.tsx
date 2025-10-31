import {
  agentRatingRepository,
  categoryRepository,
} from "@sokosumi/database/repositories";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AgentsNotAvailable } from "@/components/agents";
import type { Category } from "@/lib/types/category";
import { agentService } from "@/lib/services";
import { AGENT_CATEGORY_SLUGS } from "@/lib/constants/agent-categories";

import FilterSection from "./components/filter-section";
import FilteredAgents from "./components/filtered-agents";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Agents.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function GalleryPage() {
  const agentsWithPrice =
    await agentService.getAvailableAgentsWithCreditsPrice();

  if (!agentsWithPrice.length) {
    return <AgentsNotAvailable />;
  }

  const t = await getTranslations("App.Agents.FilterSection");

  const categories = await categoryRepository.getCategories();

  // Priority map for sorting: Featured → New → Regular → Others
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
    {
      slug: AGENT_CATEGORY_SLUGS.OTHERS,
      name: t("others"),
    },
  ].sort((a, b) => {
    const priorityA = categoryPriority[a.slug] ?? 3;
    const priorityB = categoryPriority[b.slug] ?? 3;
    return priorityA - priorityB;
  });

  const favoriteAgents = await agentService.getFavoriteAgents();

  // Fetch rating stats for all agents
  const agentIds = agentsWithPrice.map((agent) => agent.id);
  const ratingStatsMap =
    await agentRatingRepository.getAgentsRatingStats(agentIds);

  return (
    <div className="w-full">
      <div className="space-y-12 px-2">
        <FilterSection categories={categoryMap} />
        {/* Agent Cards Grid */}
        <FilteredAgents
          agents={agentsWithPrice}
          favoriteAgents={favoriteAgents}
          ratingStatsMap={ratingStatsMap}
          categories={categoryMap}
        />
      </div>
    </div>
  );
}
