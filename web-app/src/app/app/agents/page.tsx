import { Tag } from "@prisma/client";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { requireAuthentication } from "@/lib/auth/utils";
import { AgentDTO } from "@/lib/db/dto/AgentDTO";
import { getAgents } from "@/lib/db/services/agent.service";
import { getOrCreateFavoriteAgentList } from "@/lib/db/services/agentList.service";
import { getCachedTags } from "@/lib/db/services/tag.service";

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
  const agents: AgentDTO[] = await getAgents();
  const tags: Tag[] = await getCachedTags();
  const tagNames = tags.map((tag) => tag.name);

  const { session } = await requireAuthentication();

  const agentList = await getOrCreateFavoriteAgentList(session.user.id);

  return (
    <div className="w-full px-4 py-4 sm:px-8 xl:px-16">
      <div className="space-y-12">
        <FilterSection tags={tagNames} />
        {/* Agent Cards Grid */}
        <FilteredAgents agents={agents} agentList={agentList} />
      </div>
    </div>
  );
}
