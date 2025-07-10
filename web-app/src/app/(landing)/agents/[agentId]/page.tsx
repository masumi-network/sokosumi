import { notFound } from "next/navigation";

import { AgentDetail } from "@/components/agents";
import {
  CreateJobModal,
  CreateJobModalContextProvider,
} from "@/components/create-job-modal";
import { retrieveJobsWithLimitedInformationByAgentId } from "@/lib/db/repositories";
import { getAgentCreditsPrice, getAvailableAgentById } from "@/lib/services";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;

  const agent = await getAvailableAgentById(agentId);
  if (!agent) {
    return notFound();
  }
  const agentCreditsPrice = await getAgentCreditsPrice(agent);
  if (!agentCreditsPrice) {
    return notFound();
  }

  const jobs = await retrieveJobsWithLimitedInformationByAgentId(agentId);

  return (
    <CreateJobModalContextProvider
      agentsWithPrice={[{ agent, creditsPrice: agentCreditsPrice }]}
    >
      <AgentDetail
        agent={agent}
        agentCreditsPrice={agentCreditsPrice}
        jobs={jobs}
      />
      {/* Create Job Modal */}
      <CreateJobModal />
    </CreateJobModalContextProvider>
  );
}
