import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AgentsNotAvailable } from "@/components/agents";
import { getSessionOrRedirect } from "@/lib/auth/utils";
import { tagRepository } from "@/lib/db/repositories";
import {
  getAvailableAgentsWithCreditsPrice,
  getFavoriteAgents,
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
  await getSessionOrRedirect();

  const agentsWithPrice = await getAvailableAgentsWithCreditsPrice();

  if (!agentsWithPrice.length) {
    return <AgentsNotAvailable />;
  }

  const tags: Tag[] = await tagRepository.getTags();
  const tagNames = tags.map((tag) => tag.name);

  const favoriteAgents = await getFavoriteAgents();

  return (
    <div className="w-full">
      <div className="space-y-12">
        <FilterSection tags={tagNames} />
        {/* Agent Cards Grid */}
        <FilteredAgents
          agents={agentsWithPrice.map((item) => item.agent)}
          favoriteAgents={favoriteAgents}
          agentCreditsPriceList={agentsWithPrice.map(
            (item) => item.creditsPrice,
          )}
        />
      </div>
    </div>
  );
}
