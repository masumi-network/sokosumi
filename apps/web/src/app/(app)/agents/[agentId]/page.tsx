import { notFound } from "next/navigation";

import { AgentDetail, AgentDetailViewTracker } from "@/components/agents";
import AgentBottomNavigation from "@/components/agents/agent-botton-navigation";
import AgentMobileHeader from "@/components/agents/agent-mobile-header";
import {
  CreateJobModal,
  CreateJobModalContextProvider,
} from "@/components/create-job-modal";
import { mapCoreAgentReviews } from "@/lib/agents/core-dto-mappers";
import { getCoreAgentById } from "@/lib/agents/core-loaders";
import { getSession } from "@/lib/auth/auth.server";
import { coreClient } from "@/lib/clients/core.client";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { agentService } from "@/lib/services";
import { getAgentRatingStats } from "@/lib/types/core-dto";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;

  const agent = await getCoreAgentById(agentId);
  if (!agent) {
    return notFound();
  }

  const session = await getSession();
  const userId = session?.user.id ?? null;

  const [reviewsResponse, projectOptions] = await Promise.all([
    coreClient.getAgentReviews(agentId),
    session ? getProjectFilterOptions() : Promise.resolve(undefined),
  ]);
  const { ratingDistribution, ratingsWithComments } = mapCoreAgentReviews(
    reviewsResponse.data,
  );
  const executedJobsCount = agent.metrics.executions.count;
  const averageExecutionDuration = agent.metrics.executions.averageTime;
  const ratingStats = getAgentRatingStats(agent);

  const canRate = userId ? await agentService.canUserRateAgent(agentId) : false;

  const existingRating =
    userId && canRate
      ? await agentService.getUserRatingForAgent(agentId)
      : null;

  return (
    <CreateJobModalContextProvider
      agentsWithPrice={[agent]}
      averageExecutionDuration={averageExecutionDuration}
      projectOptions={projectOptions}
    >
      <AgentMobileHeader agent={agent} />
      <div className="min-h-full w-full">
        <div className="mx-auto w-full max-w-4xl">
          <AgentDetailViewTracker agent={agent} />
          <AgentDetail
            agent={agent}
            executedJobsCount={executedJobsCount}
            averageExecutionDuration={averageExecutionDuration}
            ratingStats={ratingStats}
            ratingDistribution={ratingDistribution}
            ratingsWithComments={ratingsWithComments}
            canRate={canRate}
            existingRating={existingRating}
            showBackButton={true}
          />
        </div>
      </div>
      <AgentBottomNavigation agent={agent} />
      <CreateJobModal />
    </CreateJobModalContextProvider>
  );
}
