import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import {
  AgentCard,
  AgentModal,
  Agents,
  AgentsNotAvailable,
} from "@/components/agents";
import { AgentWithRelations, getAgents } from "@/lib/db";
import { getAgentCreditsPrice } from "@/lib/services";

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

  const agentCreditsPriceList = await Promise.all(
    agents.map((agent) => getAgentCreditsPrice(agent)),
  );

  return (
    <div className="container mx-auto px-12 pt-4 pb-8">
      <div className="space-y-24">
        {/* Featured Agent Section */}
        <AgentCard
          agent={agents[0]}
          agentCreditsPrice={agentCreditsPriceList[0]}
          className="w-full"
          size="lg"
        />

        {/* Agent Cards Grid */}
        <Agents agents={agents} agentCreditsPriceList={agentCreditsPriceList} />

        {/* Agent Modal Wrapper */}
        <AgentModal />
      </div>
    </div>
  );
}
