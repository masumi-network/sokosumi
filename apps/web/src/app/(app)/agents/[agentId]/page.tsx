import { notFound } from "next/navigation";

import { AgentDetail, AgentDetailViewTracker } from "@/components/agents";
import AgentBottomNavigation from "@/components/agents/agent-botton-navigation";
import AgentMobileHeader from "@/components/agents/agent-mobile-header";
import {
  CreateJobModal,
  CreateJobModalContextProvider,
} from "@/components/create-job-modal";
import {
  mapCoreAgentMetricsToRatingStats,
  mapCoreAgentReviews,
  mapCoreAgentToAgentWithCreditsPrice,
} from "@/lib/agents/core-dto-mappers";
import { getCoreAgentById } from "@/lib/agents/core-loaders";
import { getSession } from "@/lib/auth/auth.server";
import { coreClient } from "@/lib/clients/core.client";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { agentService } from "@/lib/services";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;

  const coreAgent = await getCoreAgentById(agentId);
  if (!coreAgent) {
    return notFound();
  }

  const agentWithCreditsPrice = mapCoreAgentToAgentWithCreditsPrice(coreAgent);
  const session = await getSession();
  const userId = session?.user.id ?? null;

  const [reviewsResponse, projectOptions] = await Promise.all([
    coreClient.getAgentReviews(agentId),
    session ? getProjectFilterOptions() : Promise.resolve(undefined),
  ]);
  const { ratingDistribution, ratingsWithComments } = mapCoreAgentReviews(
    reviewsResponse.data,
  );
  const executedJobsCount = coreAgent.metrics.executions.count;
  const averageExecutionDuration = coreAgent.metrics.executions.averageTime;
  const ratingStats = mapCoreAgentMetricsToRatingStats(coreAgent);

  const canRate = userId ? await agentService.canUserRateAgent(agentId) : false;

  const existingRating =
    userId && canRate
      ? await agentService.getUserRatingForAgent(agentId)
      : null;

  return (
    <CreateJobModalContextProvider
      agentsWithPrice={[agentWithCreditsPrice]}
      averageExecutionDuration={averageExecutionDuration}
      projectOptions={projectOptions}
    >
      <AgentMobileHeader agent={agentWithCreditsPrice} />
      <div className="min-h-full w-full">
        <div className="mx-auto w-full max-w-4xl">
          <AgentDetailViewTracker agent={agentWithCreditsPrice} />
          <AgentDetail
            agent={agentWithCreditsPrice}
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
      <AgentBottomNavigation agent={agentWithCreditsPrice} />
      {/* Create Job Modal */}
      <CreateJobModal />
    </CreateJobModalContextProvider>
  );
}
