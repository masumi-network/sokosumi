import { notFound } from "next/navigation";

import { AgentDetail, AgentDetailViewTracker } from "@/components/agents";
import { mapCoreAgentReviews } from "@/lib/agents/core-dto-mappers";
import { getCoreAgentById } from "@/lib/agents/core-loaders";
import { getSession } from "@/lib/auth/auth.server";
import { coreClient } from "@/lib/clients/core.client";
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

  // Wave 2: reviews and rating reads share no mutual deps.
  const [reviewsResponse, canRate, myReview] = await Promise.all([
    coreClient.getAgentReviews(agentId),
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
  );
}
