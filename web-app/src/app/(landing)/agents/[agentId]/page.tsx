import { notFound } from "next/navigation";

import { AgentDetails } from "@/components/agents";
import { getAgentById } from "@/lib/db";
import { getAgentCreditsPrice } from "@/lib/services";

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

  return <AgentDetails agent={agent} agentCreditsPrice={agentCreditsPrice} />;
}
