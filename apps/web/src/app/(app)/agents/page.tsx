import { agentRatingRepository } from "@sokosumi/database/repositories";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AgentsNotAvailable } from "@/components/agents";
import { CoworkerGallerySection } from "@/components/agents/coworker-gallery-section";
import prisma from "@/lib/db/prisma";
import { agentService, categoryService } from "@/lib/services";
import { coworkerService } from "@/lib/services/coworker.service";

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

  const [categoryMap, coworkers] = await Promise.all([
    categoryService.getValidCategories(),
    coworkerService.listCoworkers(),
  ]);
  const favoriteAgents = await agentService.getFavoriteAgents();

  // Fetch rating stats for all agents
  const agentIds = agentsWithPrice.map((agent) => agent.id);
  const ratingStatsMap = await agentRatingRepository.getAgentsRatingStats(
    agentIds,
    prisma,
  );

  return (
    <div className="w-full">
      <div className="space-y-12 px-2">
        <FilterSection categories={categoryMap} />

        <CoworkerGallerySection coworkers={coworkers} />

        <div className="space-y-6">
          <FilteredAgents
            agents={agentsWithPrice}
            favoriteAgents={favoriteAgents}
            ratingStatsMap={ratingStatsMap}
            categories={categoryMap}
          />
        </div>
      </div>
    </div>
  );
}
