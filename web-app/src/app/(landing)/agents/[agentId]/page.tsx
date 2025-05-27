import { notFound } from "next/navigation";

import { AgentDetail } from "@/components/agents";
import {
  CreateJobModal,
  CreateJobModalContextProvider,
} from "@/components/create-job-modal";
import { getAgentById, getJobsByAgentId } from "@/lib/db";
import { getAgentCreditsPrice, getAgentInputSchema } from "@/lib/services";

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

  const jobs = await getJobsByAgentId(agentId);

  const agentInputSchemaPromise = getAgentInputSchema(agentId);

  return (
    <CreateJobModalContextProvider>
      <AgentDetail
        agent={agent}
        agentCreditsPrice={agentCreditsPrice}
        jobs={jobs}
      />
      {/* Create Job Modal */}
      <CreateJobModal
        agent={agent}
        agentCreditsPrice={agentCreditsPrice}
        inputSchemaPromise={agentInputSchemaPromise}
      />
    </CreateJobModalContextProvider>
  );
}
