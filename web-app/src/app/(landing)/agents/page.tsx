import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import {
  AgentCard,
  AgentModal,
  Agents,
  AgentsNotAvailable,
} from "@/components/agents";
import { getOnlineAgentsWithCreditsPrice } from "@/lib/services";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Landing.Agents.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function GalleryPage() {
  const agentsWithPrice = await getOnlineAgentsWithCreditsPrice();

  if (!agentsWithPrice.length) {
    return <AgentsNotAvailable />;
  }

  return (
    <div className="container mx-auto px-12 pt-4 pb-8">
      <div className="space-y-24">
        {/* Featured Agent Section */}
        <AgentCard
          agent={agentsWithPrice[0].agent}
          agentCreditsPrice={agentsWithPrice[0].creditsPrice}
          className="w-full"
          size="lg"
        />

        {/* Agent Cards Grid */}
        <Agents
          agents={agentsWithPrice.map((item) => item.agent)}
          agentCreditsPriceList={agentsWithPrice.map(
            (item) => item.creditsPrice,
          )}
        />

        {/* Agent Modal Wrapper */}
        <AgentModal />
      </div>
    </div>
  );
}
