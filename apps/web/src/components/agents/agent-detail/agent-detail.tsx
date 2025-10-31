import {
  type AgentRatingStats,
  UserAgentRatingWithUser,
} from "@sokosumi/database";
import { AgentWithCreditsPrice, AgentWithRelations } from "@sokosumi/database";

import { getAgentExampleOutput, getAgentLegal } from "@/lib/helpers/agent";
import { cn } from "@/lib/utils";

import { CardSection } from "./card-section";
import {
  AgentDetailExamples,
  AgentDetailExamplesSkeleton,
} from "./examples/examples";
import { AgentDetailHeader, AgentDetailHeaderSkeleton } from "./header";
import { AgentDetailLegal, AgentDetailLegalSkeleton } from "./legal";
import { AgentDetailOverview, AgentDetailOverviewSkeleton } from "./overview";
import { AgentDetailReviews, AgentDetailReviewsSkeleton } from "./reviews";
import { AgentDetailRisk, AgentDetailRiskSkeleton } from "./risk";
import { AgentDetailStats, AgentDetailStatsSkeleton } from "./stats";

interface AgentDetailProps {
  agent: AgentWithCreditsPrice;
  executedJobsCount: number;
  averageExecutionDuration: number;
  favoriteAgents?: AgentWithRelations[] | undefined;
  ratingStats: AgentRatingStats;
  ratingDistribution?: Record<number, number> | undefined;
  ratingsWithComments?: UserAgentRatingWithUser[] | undefined;
  canRate?: boolean | undefined;
  existingRating?:
    | {
        rating: number;
        comment: string | null;
      }
    | null
    | undefined;
  showBackButton?: boolean | undefined;
  showCloseButton?: boolean | undefined;
  onClose?: (() => void) | undefined;
  className?: string | undefined;
  cardClassName?: string | undefined;
}

export function AgentDetail({
  agent,
  executedJobsCount,
  averageExecutionDuration,
  favoriteAgents,
  ratingStats,
  ratingDistribution,
  ratingsWithComments,
  canRate,
  existingRating,
  showBackButton,
  showCloseButton,
  onClose,
  className,
  cardClassName = "agent-detail-card p-3 md:p-6",
}: AgentDetailProps) {
  const exampleOutputs = getAgentExampleOutput(agent);
  const legal = getAgentLegal(agent);

  return (
    <div className={cn("flex w-full max-w-3xl flex-col gap-1.5", className)}>
      <CardSection className={cardClassName}>
        <AgentDetailHeader
          agent={agent}
          favoriteAgents={favoriteAgents}
          showBackButton={showBackButton}
          showCloseButton={showCloseButton}
          onClose={onClose}
        />
      </CardSection>
      <CardSection className={cardClassName}>
        <AgentDetailStats
          executedJobsCount={executedJobsCount}
          averageExecutionDuration={averageExecutionDuration}
          ratingStats={ratingStats}
        />
      </CardSection>
      <CardSection className={cardClassName}>
        <AgentDetailOverview agent={agent} />
      </CardSection>
      {exampleOutputs.length > 0 && (
        <CardSection className={cardClassName}>
          <AgentDetailExamples exampleOutputs={exampleOutputs} />
        </CardSection>
      )}
      {legal && (
        <CardSection className={cardClassName}>
          <AgentDetailLegal legal={legal} />
        </CardSection>
      )}
      <CardSection className={cardClassName}>
        <AgentDetailRisk agent={agent} />
      </CardSection>
      {(ratingStats.totalRatings > 0 || canRate) && (
        <CardSection className={cardClassName}>
          <AgentDetailReviews
            agentId={agent.id}
            ratingStats={ratingStats}
            distribution={ratingDistribution ?? {}}
            ratingsWithComments={ratingsWithComments ?? []}
            canRate={canRate ?? false}
            existingRating={existingRating ?? null}
          />
        </CardSection>
      )}
    </div>
  );
}

export function AgentDetailSkeleton({
  className,
}: {
  className?: string | undefined;
}) {
  return (
    <div className={cn("flex w-full max-w-3xl flex-col gap-1.5", className)}>
      <CardSection>
        <AgentDetailHeaderSkeleton />
      </CardSection>
      <CardSection>
        <AgentDetailStatsSkeleton />
      </CardSection>
      <CardSection>
        <AgentDetailOverviewSkeleton />
      </CardSection>
      <CardSection>
        <AgentDetailExamplesSkeleton />
      </CardSection>
      <CardSection>
        <AgentDetailLegalSkeleton />
      </CardSection>
      <CardSection>
        <AgentDetailRiskSkeleton />
      </CardSection>
      <CardSection>
        <AgentDetailReviewsSkeleton />
      </CardSection>
    </div>
  );
}
