import {
  agentRatingRepository,
  jobRepository,
} from "@sokosumi/database/repositories";
import { notFound } from "next/navigation";

import { AgentDetail, AgentDetailViewTracker } from "@/components/agents";
import AgentBottomNavigation from "@/components/agents/agent-botton-navigation";
import AgentMobileHeader from "@/components/agents/agent-mobile-header";
import {
  CreateJobModal,
  CreateJobModalContextProvider,
} from "@/components/create-job-modal";
import { getSession } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";
import { agentService } from "@/lib/services";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
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
  const session = await getSession();
  const userId = session?.user.id ?? null;

  const [
    executedJobsCount,
    averageExecutionDuration,
    ratingStats,
    distribution,
    ratingsWithComments,
  ] = await Promise.all([
    jobRepository.getExecutedJobsCountByAgentId(agentId, prisma),
    jobRepository.getAverageExecutionDurationByAgentId(agentId, prisma),
    agentService.getAgentRatingStats(agentId),
    agentRatingRepository.getRatingDistribution(agentId, prisma),
    agentRatingRepository.getRatingsByAgentId(agentId, 10, 0, true, prisma),
  ]);

  // Check if user can rate this agent and get existing rating
  const canRate = userId
    ? await agentService.canUserRateAgent(userId, agentId)
    : false;

  const existingRating =
    userId && canRate
      ? await agentService.getUserRatingForAgent(userId, agentId)
      : null;

  return (
    <CreateJobModalContextProvider
      agentsWithPrice={[agentWithCreditsPrice]}
      averageExecutionDuration={averageExecutionDuration}
    >
      <AgentMobileHeader agent={agentWithCreditsPrice} />
      <div className="min-h-full w-full">
        <div className="mx-auto w-full max-w-4xl">
          <AgentDetailViewTracker agent={agentWithCreditsPrice} />
          <AgentDetail
            agent={agentWithCreditsPrice}
            executedJobsCount={executedJobsCount}
            averageExecutionDuration={averageExecutionDuration}
            favoriteAgents={favoriteAgents}
            ratingStats={ratingStats}
            ratingDistribution={distribution}
            ratingsWithComments={ratingsWithComments}
            canRate={canRate}
            existingRating={existingRating}
            showBackButton={true}
          />
        </div>
      </div>
      <AgentBottomNavigation
        agent={agentWithCreditsPrice}
        favoriteAgents={favoriteAgents}
      />
      {/* Create Job Modal */}
      <CreateJobModal />
    </CreateJobModalContextProvider>
  );
}
