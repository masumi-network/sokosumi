import { notFound } from "next/navigation";

import { AgentDetails } from "@/components/agents";
import { requireAuthentication } from "@/lib/auth/utils";
import { getAgentById } from "@/lib/db/services/agent.service";
import { getOrCreateFavoriteAgentList } from "@/lib/db/services/agentList.service";
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
  const { session } = await requireAuthentication();
  const agentList = await getOrCreateFavoriteAgentList(session.user.id);
  const agentCreditCost = await calculateAgentCreditCost(agent);
  const agentPrice = convertBaseUnitsToCredits(agentCreditCost.credits);

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
