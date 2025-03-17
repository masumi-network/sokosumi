import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import Agents, { EmptyGallery } from "@/components/agents";
import { AgentDTO } from "@/lib/db/dto/AgentDTO";
import { getCachedAgents } from "@/lib/db/services/agent.service";

import FilterSection from "./components/filter-section";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Gallery.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function GalleryPage() {
  const agents: AgentDTO[] = await getCachedAgents();

  if (!agents.length) {
    return <EmptyGallery />;
  }

  return (
    <div className="w-full p-8 xl:px-16">
      <div className="space-y-12">
        <FilterSection />
        {/* Agent Cards Grid */}
        <Agents agents={agents} />
      </div>
    </div>
  );
}
