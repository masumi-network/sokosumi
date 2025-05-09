import { notFound } from "next/navigation";

import { AgentModalContent } from "@/components/agents";
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

  const { session } = await requireAuthentication();
  const userId = session.user.id;

  const agent = await getAgentById(agentId);
  if (!agent) {
    return notFound();
  }

  const agentCreditsPrice = await getAgentCreditsPrice(agent);
  if (!agentCreditsPrice) {
    return notFound();
  }

  const agentList = await getOrCreateFavoriteAgentList(userId);
  const jobs = await getJobsByAgentId(agentId);

  return (
    <AgentModalContent
      agent={agent}
      agentCreditsPrice={agentCreditsPrice}
      agentList={agentList}
      jobs={jobs}
    />
  );
}
