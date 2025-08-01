import { notFound } from "next/navigation";

import { AgentDetail } from "@/components/agents";
import {
  CreateJobModal,
  CreateJobModalContextProvider,
} from "@/components/create-job-modal";
import { getSessionOrRedirect } from "@/lib/auth/utils";
import { jobRepository } from "@/lib/db/repositories";
import {
  getAgentCreditsPrice,
  getAvailableAgentById,
  getFavoriteAgents,
} from "@/lib/services";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  await getSessionOrRedirect();

  const { agentId } = await params;

  const agent = await getAvailableAgentById(agentId);
  if (!agent) {
    return notFound();
  }

  const agentCreditsPrice = await getAgentCreditsPrice(agent);
  if (!agentCreditsPrice) {
    return notFound();
  }

  const favoriteAgents = await getFavoriteAgents();
  const [executedJobsCount, averageExecutionDuration] = await Promise.all([
    jobRepository.getExecutedJobsCountByAgentId(agentId),
    jobRepository.getAverageExecutionDurationByAgentId(agentId),
  ]);

  return (
    <CreateJobModalContextProvider
      agentsWithPrice={[{ agent, creditsPrice: agentCreditsPrice }]}
      averageExecutionDuration={averageExecutionDuration}
    >
      <div className="mx-auto flex justify-center px-4 py-8">
        <AgentDetail
          agent={agent}
          agentCreditsPrice={agentCreditsPrice}
          executedJobsCount={executedJobsCount}
          averageExecutionDuration={averageExecutionDuration}
          favoriteAgents={favoriteAgents}
        />
      </div>
      {/* Create Job Modal */}
      <CreateJobModal />
    </CreateJobModalContextProvider>
  );
}
