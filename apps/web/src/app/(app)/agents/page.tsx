import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AgentsNotAvailable } from "@/components/agents";
import { CoworkerGallerySection } from "@/components/agents/coworker-gallery-section";
import {
  mapCoreAgentRatingStatsMap,
  mapCoreAgentsToAgentWithCreditsPrice,
  mapCoreCategoriesToCategories,
} from "@/lib/agents/core-dto-mappers";
import { getAllCoreAgents } from "@/lib/agents/core-loaders";
import { coreClient } from "@/lib/clients/core.client";
import { agentService } from "@/lib/services";

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
  const [coreAgents, categoriesResponse, favoriteAgents, coworkersResponse] =
    await Promise.all([
      getAllCoreAgents(),
      coreClient.getCategories(),
      // TODO(core-api): replace with a Core favorites API when available.
      agentService.getFavoriteAgents(),
      coreClient.getCoworkers({
        scope: "whitelisted",
      }),
    ]);
  const agentsWithPrice = mapCoreAgentsToAgentWithCreditsPrice(coreAgents);

  if (!agentsWithPrice.length) {
    return <AgentsNotAvailable />;
  }

  const categories = mapCoreCategoriesToCategories(categoriesResponse.data);
  const ratingStatsMap = mapCoreAgentRatingStatsMap(coreAgents);

  return (
    <div className="w-full">
      <div className="space-y-12 px-2">
        <FilterSection categories={categories} />

        <CoworkerGallerySection coworkers={coworkersResponse.data} />

        <div className="space-y-6">
          <FilteredAgents
            agents={agentsWithPrice}
            favoriteAgents={favoriteAgents}
            ratingStatsMap={ratingStatsMap}
            categories={categories}
          />
        </div>
      </div>
    </div>
  );
}
