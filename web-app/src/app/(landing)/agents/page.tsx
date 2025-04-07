import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Agents, AgentsNotAvailable } from "@/components/agents";
import { AgentWithRelations, getAgents } from "@/lib/db/services/agent.service";
import { calculateAgentHumandReadableCreditCost } from "@/lib/db/services/credit.service";

import { FeaturedAgent } from "./components/featured-agent";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Landing.Agents.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function GalleryPage() {
  const agents: AgentWithRelations[] = await getAgents();

  if (!agents.length) {
    return <AgentsNotAvailable />;
  }

  const agentPriceList = await Promise.all(
    agents.map(
      async (agent) => await calculateAgentHumandReadableCreditCost(agent),
    ),
  );
  return (
    <div className="container mx-auto px-4 pt-4 pb-8">
      <div className="space-y-12">
        {/* Featured Agent Section */}
        <FeaturedAgent agent={agents[0]} />

        {/* Agent Cards Grid */}
        <Agents agents={agents} agentPriceList={agentPriceList} />
      </div>
    </div>
  );
}
