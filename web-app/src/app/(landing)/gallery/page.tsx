import { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

import AgentCard from "@/components/agent-card";
import {
  AgentWithRelations,
  getAverageRating,
  getCredits,
  getDescription,
  getImageUrl,
  getName,
  getTags,
} from "@/lib/db/agent/agent-helper";
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
  const agents: AgentWithRelations[] = await getCachedAgents();

  if (!agents.length) {
    return <EmptyGallery />;
  }

  return (
    <div className="container mx-auto px-4 pt-4 pb-8">
      <div className="space-y-12">
        {/* Featured Agent Section */}
        <FeaturedAgent
          id={agents[0].id}
          name={getName(agents[0])}
          description={getDescription(agents[0]) ?? ""}
          image={getImageUrl(agents[0])}
          tags={getTags(agents[0])}
        />

        {/* Agent Cards Grid */}
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              id={agent.id}
              name={getName(agent)}
              description={getDescription(agent) ?? ""}
              averageStars={getAverageRating(agent)}
              image={getImageUrl(agent)}
              price={getCredits(agent)}
              tags={getTags(agent)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
