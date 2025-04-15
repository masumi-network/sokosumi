import { notFound } from "next/navigation";

import { AgentDetails } from "@/components/agents";
import { getAgentById } from "@/lib/db/services/agent.service";
import { calculateAgentCreditCost } from "@/lib/db/services/credit.service";
import { convertBaseUnitsToCredits } from "@/lib/db/utils/credit.utils";

import BackToGallery from "./components/back-to-gallery";

export default async function Page({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const agent = await getAgentById(agentId);

  if (!agent) {
    notFound();
  }

  const agentPriceCreditCost = await calculateAgentCreditCost(agent);
  const agentPriceCredits = convertBaseUnitsToCredits(
    agentPriceCreditCost.credits,
  );

  return (
    <div className="container mx-auto space-y-8 p-4 pb-16 xl:p-8">
      <BackToGallery />
      <AgentDetails agent={agent} agentPrice={agentPriceCredits} />
    </div>
  );
}
