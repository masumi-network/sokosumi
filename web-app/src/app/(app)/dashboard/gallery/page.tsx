import { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import Agents from "@/components/agents";
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

function EmptyGallery() {
  const t = useTranslations("App.Gallery");

  return (
    <div className="container mx-auto px-4 pt-4 pb-8">
      <div className="flex h-[50vh] items-center justify-center">
        <p className="text-muted-foreground text-lg">
          {t("noAgentsAvailable")}
        </p>
      </div>
    </div>
  );
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
