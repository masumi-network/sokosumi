import type { AgentReview } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";
import { AgentRatingForm } from "@/components/agents/agent-rating-form";
import { RatingDistribution } from "@/components/agents/rating-distribution";
import { StarRating } from "@/components/agents/star-rating";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import type { AgentRatingStats } from "@/lib/types/core-dto";
import { cn } from "@/lib/utils";

import { ReviewsList } from "./reviews-list";

interface AgentDetailReviewsProps {
  agentId: string;
  ratingStats: AgentRatingStats;
  distribution: Record<number, number>;
  ratingsWithComments: AgentReview[];
  canRate: boolean;
  existingRating: {
    rating: number;
    comment: string | null;
  } | null;
}

export async function AgentDetailReviews({
  agentId,
  ratingStats,
  distribution,
  ratingsWithComments,
  canRate,
  existingRating,
}: AgentDetailReviewsProps) {
  const t = await getTranslations("Components.Agents.Reviews");

  const hasRatings = ratingStats.total > 0;

  return (
    <section className="space-y-2">
      <h3 className="text-muted-foreground px-2 pt-2 text-xs font-medium">
        {t("customerReviews")}
      </h3>
      {hasRatings ? (
        <>
          <div className="grid gap-2 lg:grid-cols-2 lg:items-start">
            <div className="space-y-4">
              <div className={cn(HOLDER_ITEM_CLASS, "space-y-3 p-4")}>
                <StarRating
                  averageRating={ratingStats.average ?? 0}
                  totalRatings={ratingStats.total}
                  size="lg"
                />
                <RatingDistribution
                  distribution={distribution}
                  totalRatings={ratingStats.total}
                />
              </div>
            </div>
            <div className="space-y-3">
              <ReviewsList ratingsWithComments={ratingsWithComments} />
            </div>
          </div>
          {canRate ? (
            <div className={cn(HOLDER_ITEM_CLASS, "p-4")}>
              <AgentRatingForm
                agentId={agentId}
                existingRating={existingRating?.rating ?? null}
                existingComment={existingRating?.comment ?? null}
              />
            </div>
          ) : null}
        </>
      ) : (
        <div>
          {canRate && (
            <div className="w-full">
              <p className="text-muted-foreground mb-2 px-2 text-sm">
                {t("beFirstToReview")}
              </p>
              <div className={cn(HOLDER_ITEM_CLASS, "p-4")}>
                <AgentRatingForm
                  agentId={agentId}
                  existingRating={existingRating?.rating ?? null}
                  existingComment={existingRating?.comment ?? null}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
