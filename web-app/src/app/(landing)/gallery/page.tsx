import { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import AgentCard from "@/components/agent-card";
import { AgentDTO } from "@/lib/db/dto/AgentDTO";
import { getCachedAgents } from "@/lib/db/services/agent.service";

import { FeaturedAgent } from "./featured-agent";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Landing.Gallery.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

function EmptyGallery() {
  const t = useTranslations("Landing.Gallery");

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
    <div className="container mx-auto px-4 pt-4 pb-8">
      <div className="space-y-12">
        {/* Featured Agent Section */}
        <FeaturedAgent
          id={agents[0].id}
          name={agents[0].name}
          description={agents[0].description ?? ""}
          image={agents[0].image}
          tags={agents[0].tags}
        />

        {/* Agent Cards Grid */}
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              id={agent.id}
              name={agent.name}
              description={agent.description ?? ""}
              averageStars={agent.Rating.averageStars}
              image={agent.image}
              price={agent.Pricing.credits}
              tags={agent.tags}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
