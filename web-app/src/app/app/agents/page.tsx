import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { requireAuthentication } from "@/lib/auth/utils";
import { AgentWithRelations, getOnlineAgents, getTags } from "@/lib/db";
import {
  getAgentCreditsPrice,
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
  const agents: AgentWithRelations[] = await getOnlineAgents();
  const tags: Tag[] = await getTags();
  const tagNames = tags.map((tag) => tag.name);

  const { session } = await requireAuthentication();
  const favoriteAgentList = await getOrCreateFavoriteAgentList(session.user.id);
  const agentCreditsPriceList = await Promise.all(
    agents.map((agent) => getAgentCreditsPrice(agent)),
  );

  return (
    <div className="w-full px-4 py-4 sm:px-8 xl:px-16">
      <div className="space-y-12">
        <FilterSection tags={tagNames} />
        {/* Agent Cards Grid */}
        <FilteredAgents
          agents={agents}
          agentList={favoriteAgentList}
          agentCreditsPriceList={agentCreditsPriceList}
        />
      </div>
    </div>
  );
}
