import { notFound } from "next/navigation";

import { AgentDetail } from "@/components/agents";
import {
  CreateJobModal,
  CreateJobModalContextProvider,
} from "@/components/create-job-modal";
import { getSessionOrRedirect } from "@/lib/auth/utils";
import { AgentService, getAgentCreditsPrice, JobService } from "@/lib/services";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  await getSessionOrRedirect();

  const { agentId } = await params;

  const agentService = AgentService.getInstance();
  const agent = await agentService.getAvailableAgentById(agentId);
  if (!agent) {
    return notFound();
  }

  const agentCreditsPrice = await getAgentCreditsPrice(agent);
  if (!agentCreditsPrice) {
    return notFound();
  }

  const favoriteAgents = await agentService.getFavoriteAgents();
  const jobs =
    await JobService.getInstance().getJobsWithLimitedInformationByAgentId(
      agentId,
    );

  return (
    <CreateJobModalContextProvider
      agentsWithPrice={[{ agent, creditsPrice: agentCreditsPrice }]}
    >
      <div className="mx-auto flex justify-center px-4 py-8">
        <AgentDetail
          agent={agent}
          agentCreditsPrice={agentCreditsPrice}
          favoriteAgents={favoriteAgents}
          jobs={jobs}
        />
      </div>
      {/* Create Job Modal */}
      <CreateJobModal />
    </CreateJobModalContextProvider>
  );
}
