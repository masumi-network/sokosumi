import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  AgentModal,
  AgentModalContent,
  AgentModalSkeleton,
} from "@/components/agents";
import { getAgentById, getJobsByAgentId } from "@/lib/db";
import { getAgentCreditsPrice } from "@/lib/services";

export default async function AgentModalPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;

  return (
    <AgentModal exactPathname={`/agents/${agentId}`}>
      <Suspense fallback={<AgentModalSkeleton />}>
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

  const agent = await getAgentById(agentId);
  if (!agent) {
    return notFound();
  }

  const agentCreditsPrice = await getAgentCreditsPrice(agent);
  if (!agentCreditsPrice) {
    return notFound();
  }

  const jobs = await getJobsByAgentId(agentId);

  return (
    <AgentModalContent
      agent={agent}
      agentCreditsPrice={agentCreditsPrice}
      jobs={jobs}
    />
  );
}
