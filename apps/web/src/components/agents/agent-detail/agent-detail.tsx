import type { AgentReview } from "@/lib/clients/generated/core";
import { getAgentExampleOutputs, getAgentLegal } from "@/lib/helpers/agent";
import type { AgentRatingStats, CoreAgentDto } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";

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
  agent: CoreAgentDto;
  executedJobsCount: number;
  averageExecutionDuration: number | null;
  ratingStats: AgentRatingStats;
  ratingDistribution?: Record<number, number> | undefined;
  ratingsWithComments?: AgentReview[] | undefined;
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
}

export function AgentDetail({
  agent,
  executedJobsCount,
  averageExecutionDuration,
  ratingStats,
  ratingDistribution,
  ratingsWithComments,
  canRate,
  existingRating,
  showBackButton,
  showCloseButton,
  onClose,
  className,
}: AgentDetailProps) {
  const exampleOutputs = getAgentExampleOutputs(agent);
  const legal = getAgentLegal(agent);

  return (
    <div
      className={cn(
        "mt-0 flex w-full flex-col space-y-8 px-4 pb-8 md:mt-4 md:px-0",
        className,
      )}
    >
      <section className="space-y-4">
        <AgentDetailHeader
          agent={agent}
          showBackButton={showBackButton}
          showCloseButton={showCloseButton}
          onClose={onClose}
        />
      </section>
      <section className="space-y-4">
        <AgentDetailStats
          executedJobsCount={executedJobsCount}
          averageExecutionDuration={averageExecutionDuration}
          ratingStats={ratingStats}
        />
      </section>
      <section className="space-y-4">
        <AgentDetailOverview agent={agent} />
      </section>
      {exampleOutputs.length > 0 && (
        <section className="space-y-4">
          <AgentDetailExamples exampleOutputs={exampleOutputs} />
        </section>
      )}
      {legal && (
        <section className="space-y-4">
          <AgentDetailLegal legal={legal} />
        </section>
      )}
      <section className="space-y-4">
        <AgentDetailRisk agent={agent} />
      </section>
      {(ratingStats.total > 0 || canRate) && (
        <section className="space-y-4">
          <AgentDetailReviews
            agentId={agent.id}
            ratingStats={ratingStats}
            distribution={ratingDistribution ?? {}}
            ratingsWithComments={ratingsWithComments ?? []}
            canRate={canRate ?? false}
            existingRating={existingRating ?? null}
          />
        </section>
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
    <div className={cn("mt-6 flex w-full flex-col space-y-8", className)}>
      <section className="space-y-4">
        <AgentDetailHeaderSkeleton />
      </section>
      <section className="space-y-4">
        <AgentDetailStatsSkeleton />
      </section>
      <section className="space-y-4">
        <AgentDetailOverviewSkeleton />
      </section>
      <section className="space-y-4">
        <AgentDetailExamplesSkeleton />
      </section>
      <section className="space-y-4">
        <AgentDetailLegalSkeleton />
      </section>
      <section className="space-y-4">
        <AgentDetailRiskSkeleton />
      </section>
      <section className="space-y-4">
        <AgentDetailReviewsSkeleton />
      </section>
    </div>
  );
}

/** Route-level Instant shell — sync only (no session/i18n/cookies). */
export function AgentDetailPageSkeleton() {
  return (
    <div className="min-h-full w-full">
      <div className="mx-auto w-full max-w-4xl">
        <AgentDetailSkeleton className="mt-4 space-y-8 px-4 pb-8 md:px-0" />
      </div>
    </div>
  );
}
