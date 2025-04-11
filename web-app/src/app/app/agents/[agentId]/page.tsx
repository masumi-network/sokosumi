import { notFound } from "next/navigation";

import { AgentDetails } from "@/components/agents";
import { requireAuthentication } from "@/lib/auth/utils";
import { getAgentById } from "@/lib/db/services/agent.service";
import { getOrCreateFavoriteAgentList } from "@/lib/db/services/agentList.service";
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
  const { session } = await requireAuthentication();
  const agentList = await getOrCreateFavoriteAgentList(session.user.id);
  const agentPrice = await calculateAgentHumandReadableCreditCost(agent);

  return (
    <div className="w-full space-y-8 px-4 py-4 sm:px-8 xl:px-16">
      <BackToGallery />
      <AgentDetails
        agent={agent}
        agentList={agentList}
        agentPrice={agentPrice}
      />
    </div>
  );
}
