import { notFound } from "next/navigation";

import { AgentDetails } from "@/components/agents";
import { getAgentById } from "@/lib/db/services/agent.service";
import { calculateAgentHumandReadableCreditCost } from "@/lib/db/services/credit.service";

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

  const agentPrice = await calculateAgentHumandReadableCreditCost(agent);

  return (
    <div className="container mx-auto space-y-8 p-4 pb-16 xl:p-8">
      <BackToGallery />
      <AgentDetails agent={agent} agentPrice={agentPrice} />
    </div>
  );
}
