import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AgentCard, Agents, AgentsNotAvailable } from "@/components/agents";
import {
  CreateJobModal,
  CreateJobModalContextProvider,
} from "@/components/create-job-modal";
import { getAvailableAgentsWithCreditsPrice } from "@/lib/services";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Landing.Agents.Metadata");

  return {
    title: t("title"),
    description: t("description"),
  };
}

export default async function GalleryPage() {
  const agentsWithPrice = await getAvailableAgentsWithCreditsPrice();

  if (!agentsWithPrice.length) {
    return <AgentsNotAvailable />;
  }

  const featuredAgentWithPrice = agentsWithPrice[0];

  return (
    <div className="container mx-auto px-4 pt-4 pb-8 md:px-12">
      <div className="space-y-24">
        <CreateJobModalContextProvider agentsWithPrice={agentsWithPrice}>
          {/* Featured Agent Section */}
          <AgentCard
            agent={featuredAgentWithPrice.agent}
            agentCreditsPrice={featuredAgentWithPrice.creditsPrice}
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

          {/* Create Job Modal */}
          <CreateJobModal />
        </CreateJobModalContextProvider>
      </div>
    </div>
  );
}
