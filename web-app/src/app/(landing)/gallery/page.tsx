import { Metadata } from "next";
import { useTranslations } from "next-intl";

import AgentCard from "@/components/agent-card";
import { dummyAgents } from "@/data/agents";

import { FeaturedAgent } from "./featured-agent";

export const metadata: Metadata = {
  title: "Agents Gallery",
  description: "Explore our collection of agents.",
};

export default function GalleryPage() {
  const t = useTranslations("Landing.Gallery");
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="space-y-12">
        {/* Featured Agent Section */}
        <FeaturedAgent
          sectionTitle={t("FeaturedAgent.title")}
          agent={dummyAgents[0]}
          buttonText={t("FeaturedAgent.button")}
        />

        {/* Agent Cards Grid */}
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {dummyAgents.map((agent, index) => (
            <AgentCard key={index} agent={agent} />
          ))}
        </div>
      </div>
    </div>
  );
}
