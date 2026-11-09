import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AgentDetail } from "@/components/agents/agent-detail/agent-detail";
import { AgentDetailViewTracker } from "@/components/agents/agent-detail/agent-detail-view-tracker";
import { mapCoreAgentReviews } from "@/lib/agents/core-dto-mappers";
import { getCoreAgentById } from "@/lib/agents/core-loaders";
import { getSession } from "@/lib/auth/auth.server";
import { coreClient } from "@/lib/clients/core.client";
import { agentService } from "@/lib/services/agent.service";
import { getAgentRatingStats } from "@/lib/types/core-dto";

import { getOwnedAgentJobsCount } from "./jobs/_lib/get-cached-my-jobs";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  await connection();
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

  // Wave 2: reviews, rating and own-jobs reads share no mutual deps.
  const [reviewsResponse, canRate, myReview, myJobsCount] = await Promise.all([
    coreClient.getAgentReviews(agentId),
    userId ? agentService.canUserRateAgent(agentId) : Promise.resolve(false),
    userId
      ? agentService.getUserRatingForAgent(agentId)
      : Promise.resolve(null),
    userId ? getOwnedAgentJobsCount(agentId) : Promise.resolve(0),
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
          myJobsCount={myJobsCount}
          showBackButton={true}
        />
      </div>
    </div>
  );
}
