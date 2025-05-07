import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { AgentModalContent } from "@/components/agents";
import { auth } from "@/lib/auth/auth";
import { getAgentById } from "@/lib/db";
import {
  getAgentCreditsPrice,
  getOrCreateFavoriteAgentList,
} from "@/lib/services";

export default async function AgentModalPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;

  const session = await auth.api.getSession({
    headers: await headers(),
  });
  const userId = session?.user.id;

  const agent = await getAgentById(agentId);
  if (!agent) {
    return notFound();
  }

  const agentCreditsPrice = await getAgentCreditsPrice(agent);
  if (!agentCreditsPrice) {
    return notFound();
  }

  const agentList = !!userId
    ? await getOrCreateFavoriteAgentList(userId)
    : undefined;

  return (
    <AgentModalContent
      agent={agent}
      agentCreditsPrice={agentCreditsPrice}
      agentList={agentList}
    />
  );
}
