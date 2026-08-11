import { notFound } from "next/navigation";

import { AgentDetail, AgentDetailViewTracker } from "@/components/agents";
import AgentBottomNavigation from "@/components/agents/agent-botton-navigation";
import AgentMobileHeader from "@/components/agents/agent-mobile-header";
import {
  CreateJobModalContextProvider,
  LazyCreateJobModal,
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

  // Wave 1: agent + session are independent.
  const [agent, session] = await Promise.all([
    getCoreAgentById(agentId),
    getSession(),
  ]);
  if (!agent) {
    return notFound();
  }

  const userId = session?.user.id ?? null;

  // Wave 2: reviews, projects, and rating reads share no mutual deps.
  const [reviewsResponse, projectOptions, canRate, myReview] =
    await Promise.all([
      coreClient.getAgentReviews(agentId),
      session ? getProjectFilterOptions() : Promise.resolve(undefined),
      userId ? agentService.canUserRateAgent(agentId) : Promise.resolve(false),
      userId
        ? agentService.getUserRatingForAgent(agentId)
        : Promise.resolve(null),
    ]);
  const { ratingDistribution, ratingsWithComments } = mapCoreAgentReviews(
    reviewsResponse.data,
  );
  const executedJobsCount = agent.metrics.executions.count;
  const averageExecutionDuration = agent.metrics.executions.averageTime;
  const ratingStats = getAgentRatingStats(agent);
  const existingRating = canRate ? myReview : null;

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
      <LazyCreateJobModal />
    </CreateJobModalContextProvider>
  );
}
