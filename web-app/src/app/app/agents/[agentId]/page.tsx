import { notFound } from "next/navigation";

import { AgentDetails } from "@/components/agents";
import { requireAuthentication } from "@/lib/auth/utils";
import { getAgentById } from "@/lib/db";
import {
  getAgentCreditsPrice,
  getOrCreateFavoriteAgentList,
} from "@/lib/services";

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
  const agentCreditsPrice = await getAgentCreditsPrice(agent);

  return (
    <AgentDetails
      agent={agent}
      agentList={agentList}
      agentCreditsPrice={agentCreditsPrice}
    />
  );
}
