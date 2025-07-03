import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AgentsNotAvailable } from "@/components/agents";
import { retrieveTags } from "@/lib/db/repositories";
import {
  getOnlineAgentsWithCreditsPrice,
  getOrCreateFavoriteAgentList,
} from "@/lib/services";
import { Tag } from "@/prisma/generated/client";

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
  const agentsWithPrice = await getOnlineAgentsWithCreditsPrice();

  if (!agentsWithPrice.length) {
    return <AgentsNotAvailable />;
  }

  const tags: Tag[] = await retrieveTags();
  const tagNames = tags.map((tag) => tag.name);

  const favoriteAgentList = await getOrCreateFavoriteAgentList();

  return (
    <div className="w-full px-4 py-4 sm:px-8 xl:px-16">
      <div className="space-y-12">
        <FilterSection tags={tagNames} />
        {/* Agent Cards Grid */}
        <FilteredAgents
          agents={agentsWithPrice.map((item) => item.agent)}
          agentList={favoriteAgentList}
          agentCreditsPriceList={agentsWithPrice.map(
            (item) => item.creditsPrice,
          )}
        />
      </div>
    </div>
  );
}
