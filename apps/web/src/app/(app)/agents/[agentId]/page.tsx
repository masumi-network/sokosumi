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
import { getAuthContext } from "@/lib/auth/utils";
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
  const authContext = await getAuthContext();

  const [
    executedJobsCount,
    averageExecutionDuration,
    ratingStats,
    distribution,
    ratingsWithComments,
  ] = await Promise.all([
    jobRepository.getExecutedJobsCountByAgentId(agentId),
    jobRepository.getAverageExecutionDurationByAgentId(agentId),
    agentService.getAgentRatingStats(agentId),
    agentRatingRepository.getRatingDistribution(agentId),
    agentRatingRepository.getRatingsByAgentId(agentId, 10, 0, true),
  ]);

  // Check if user can rate this agent and get existing rating
  const canRate = authContext?.userId
    ? await agentService.canUserRateAgent(authContext.userId, agentId)
    : false;

  const existingRating =
    authContext?.userId && canRate
      ? await agentService.getUserRatingForAgent(authContext.userId, agentId)
      : null;

  return (
    <CreateJobModalContextProvider
      agentsWithPrice={[agentWithCreditsPrice]}
      averageExecutionDuration={averageExecutionDuration}
    >
      <AgentMobileHeader agent={agentWithCreditsPrice} />
      <div className="mx-auto flex justify-center py-8 md:px-2 md:py-2">
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
        />
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
