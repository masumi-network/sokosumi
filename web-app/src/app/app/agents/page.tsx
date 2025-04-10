import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { requireAuthentication } from "@/lib/auth/utils";
import { getAgents } from "@/lib/db/services/agent.service";
import { getOrCreateFavoriteAgentList } from "@/lib/db/services/agentList.service";
import { calculateAgentHumandReadableCreditCost } from "@/lib/db/services/credit.service";
import { getTags } from "@/lib/db/services/tag.service";
import { AgentWithRelations } from "@/lib/db/types/agent.types";
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
  const agents: AgentWithRelations[] = await getAgents();
  const tags: Tag[] = await getTags();
  const tagNames = tags.map((tag) => tag.name);

  const { session } = await requireAuthentication();

  const agentList = await getOrCreateFavoriteAgentList(session.user.id);
  const agentPriceList = await Promise.all(
    agents.map(
      async (agent) => await calculateAgentHumandReadableCreditCost(agent),
    ),
  );

  return (
    <div className="w-full px-4 py-4 sm:px-8 xl:px-16">
      <div className="space-y-12">
        <FilterSection tags={tagNames} />
        {/* Agent Cards Grid */}
        <FilteredAgents
          agents={agents}
          agentList={agentList}
          agentPriceList={agentPriceList}
        />
      </div>
    </div>
  );
}
