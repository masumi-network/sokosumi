import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { AgentCard, Agents, AgentsNotAvailable } from "@/components/agents";
import {
  CreateJobModal,
  CreateJobModalContextProvider,
} from "@/components/create-job-modal";
import {
  getAgentInputSchema,
  getOnlineAgentsWithCreditsPrice,
} from "@/lib/services";

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

  const featuredAgentWithPrice = agentsWithPrice[0];
  const featuredAgentInputSchemaPromise = getAgentInputSchema(
    featuredAgentWithPrice.agent.id,
  );

  return (
    <div className="container mx-auto px-12 pt-4 pb-8">
      <div className="space-y-24">
        <CreateJobModalContextProvider>
          {/* Featured Agent Section */}
          <AgentCard
            agent={featuredAgentWithPrice.agent}
            agentCreditsPrice={featuredAgentWithPrice.creditsPrice}
            className="w-full"
            size="lg"
          />
          {/* Create Job Modal */}
          <CreateJobModal
            agent={featuredAgentWithPrice.agent}
            agentCreditsPrice={featuredAgentWithPrice.creditsPrice}
            inputSchemaPromise={featuredAgentInputSchemaPromise}
          />
        </CreateJobModalContextProvider>

        {/* Agent Cards Grid */}
        <Agents
          agents={agentsWithPrice.map((item) => item.agent)}
          agentCreditsPriceList={agentsWithPrice.map(
            (item) => item.creditsPrice,
          )}
        />
      </div>
    </div>
  );
}
