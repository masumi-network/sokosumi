import { PrismaClient } from "@prisma/client";
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import AgentCard from "@/components/agent-card";
import { AgentDTO } from "@/lib/agent/AgentDTO";

import { FeaturedAgent } from "./featured-agent";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Landing.Gallery.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function GalleryPage() {
  const prisma = new PrismaClient();
  const agents = await prisma.agent.findMany({
    include: {
      Pricing: {
        include: { FixedPricing: { include: { Amounts: true } } },
      },
      ExampleOutput: true,
      ExampleOutputOverride: true,
      Rating: true,
      UserAgentRating: true,
    },
  });
  if (!agents) {
    throw new Error("Agent not found");
  }

  const agentsDTO = agents.map((agent) => new AgentDTO(agent));
  return (
    <div className="container mx-auto px-4 pt-4 pb-8">
      <div className="space-y-12">
        {/* Featured Agent Section */}
        <FeaturedAgent
          id={agentsDTO[0].id}
          name={agentsDTO[0].name}
          description={agentsDTO[0].description ?? ""}
          image={agentsDTO[0].image}
          tags={agentsDTO[0].tags}
        />

        {/* Agent Cards Grid */}
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {agentsDTO.map((agent) => (
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
