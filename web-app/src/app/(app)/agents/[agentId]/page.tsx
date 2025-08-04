import { notFound } from "next/navigation";

import { AgentDetail } from "@/components/agents";
import {
  CreateJobModal,
  CreateJobModalContextProvider,
} from "@/components/create-job-modal";
import { getSessionOrRedirect } from "@/lib/auth/utils";
import { jobRepository } from "@/lib/db/repositories";
import { agentService } from "@/lib/services";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  await getSessionOrRedirect();

  const { agentId } = await params;

  const agent = await agentService.getAvailableAgentById(agentId);
  if (!agent) {
    return notFound();
  }

  const agentWithCreditsPrice = await agentService.getAgentCreditsPrice(agent);
  if (!agentWithCreditsPrice) {
    return notFound();
  }

  const favoriteAgents = await agentService.getFavoriteAgents();
  const [executedJobsCount, averageExecutionDuration] = await Promise.all([
    jobRepository.getExecutedJobsCountByAgentId(agentId),
    jobRepository.getAverageExecutionDurationByAgentId(agentId),
  ]);

  return (
    <CreateJobModalContextProvider
      agentsWithPrice={[agentWithCreditsPrice]}
      averageExecutionDuration={averageExecutionDuration}
    >
      <div className="mx-auto flex justify-center px-4 py-8">
        <AgentDetail
          agent={agentWithCreditsPrice}
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
