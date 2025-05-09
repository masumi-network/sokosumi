import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  AgentModal,
  AgentModalContent,
  AgentModalContentSkeleton,
} from "@/components/agents";
import { auth } from "@/lib/auth/auth";
import { getAgentById, getJobsByAgentId } from "@/lib/db";
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

  return (
    <AgentModal exactPathname={`/agents/${agentId}`}>
      <Suspense fallback={<AgentModalContentSkeleton />}>
        <AgentModalInner params={params} />
      </Suspense>
    </AgentModal>
  );
}

async function AgentModalInner({
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

  const agentList = userId
    ? await getOrCreateFavoriteAgentList(userId)
    : undefined;
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
