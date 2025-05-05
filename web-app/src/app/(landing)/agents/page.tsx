import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import {
  AgentCard,
  AgentModal,
  Agents,
  AgentsNotAvailable,
} from "@/components/agents";
import { AgentWithRelations, getOnlineAgents } from "@/lib/db";
import { getAgentCreditsPrice } from "@/lib/services";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Landing.Agents.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function GalleryPage() {
  const agents: AgentWithRelations[] = await getOnlineAgents();

  // Combine agent and price, omitting agents where getAgentCreditsPrice throws
  const agentPriceResults = await Promise.allSettled(
    agents.map(async (agent) => {
      const agentCreditsPrice = await getAgentCreditsPrice(agent);
      return { agent, agentCreditsPrice };
    }),
  );

  interface AgentWithPrice {
    agent: AgentWithRelations;
    agentCreditsPrice: Awaited<ReturnType<typeof getAgentCreditsPrice>>;
  }

  const agentsWithPrice: AgentWithPrice[] = agentPriceResults
    .filter(
      (result): result is PromiseFulfilledResult<AgentWithPrice> =>
        result.status === "fulfilled",
    )
    .map((result) => result.value);

  if (!agentsWithPrice.length) {
    return <AgentsNotAvailable />;
  }

  return (
    <div className="container mx-auto px-12 pt-4 pb-8">
      <div className="space-y-24">
        {/* Featured Agent Section */}
        <AgentCard
          agent={agentsWithPrice[0].agent}
          agentCreditsPrice={agentsWithPrice[0].agentCreditsPrice}
          className="w-full"
          size="lg"
        />

        {/* Agent Cards Grid */}
        <Agents
          agents={agentsWithPrice.map((item) => item.agent)}
          agentCreditsPriceList={agentsWithPrice.map(
            (item) => item.agentCreditsPrice,
          )}
        />

        {/* Agent Modal Wrapper */}
        <AgentModal />
      </div>
    </div>
  );
}
