import { notFound } from "next/navigation";

import { AgentDetail } from "@/components/agents";
import { requireAuthentication } from "@/lib/auth/utils";
import { getAgentById, getJobsByAgentId } from "@/lib/db";
import {
  getAgentCreditsPrice,
  getOrCreateFavoriteAgentList,
} from "@/lib/services";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;

  const agent = await getAgentById(agentId);
  if (!agent) {
    return notFound();
  }

  const agentCreditsPrice = await getAgentCreditsPrice(agent);
  if (!agentCreditsPrice) {
    return notFound();
  }

  const { session } = await requireAuthentication();
  const agentList = await getOrCreateFavoriteAgentList(session.user.id);
  const jobs = await getJobsByAgentId(agentId);

  return (
    <div className="mx-auto flex justify-center px-4 py-8">
      <AgentDetail
        agent={agent}
        agentCreditsPrice={agentCreditsPrice}
        agentList={agentList}
        jobs={jobs}
      />
    </div>
  );
}
