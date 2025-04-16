import { notFound } from "next/navigation";

import { AgentDetails } from "@/components/agents";
import { getAgentById } from "@/lib/db";
import { getAgentCreditsPrice } from "@/lib/services";

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

  const agentCreditsPrice = await getAgentCreditsPrice(agent);

  return (
    <div className="container mx-auto space-y-8 p-4 pb-16 xl:p-8">
      <BackToGallery />
      <AgentDetails agent={agent} agentCreditsPrice={agentCreditsPrice} />
    </div>
  );
}
