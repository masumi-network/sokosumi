import { Tag } from "@prisma/client";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AgentDTO } from "@/lib/db/dto/AgentDTO";
import { getCachedAgents } from "@/lib/db/services/agent.service";
import { getCachedTags } from "@/lib/db/services/tag.service";

import FilterSection from "./components/filter-section";
import FilteredAgents from "./components/filtered-agents";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Gallery.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function GalleryPage() {
  const agents: AgentDTO[] = await getCachedAgents();
  const tags: Tag[] = await getCachedTags();
  const tagNames = tags.map((tag) => tag.name);

  return (
    <div className="w-full p-8 xl:px-16">
      <div className="space-y-12">
        <FilterSection tags={tagNames} />
        {/* Agent Cards Grid */}
        <FilteredAgents agents={agents} />
      </div>
    </div>
  );
}
