import type { AgentReview } from "@sokosumi/core-client";
import { getTranslations } from "next-intl/server";
import { AgentRatingForm } from "@/components/agents/agent-rating-form";
import { RatingDistribution } from "@/components/agents/rating-distribution";
import { StarRating } from "@/components/agents/star-rating";
import type { AgentRatingStats } from "@/lib/types/core-dto";

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
    <section className="space-y-4">
      <h2 className="text-muted-foreground text-xs font-medium">
        {t("customerReviews")}
      </h2>
      {hasRatings ? (
        <>
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <div className="space-y-4">
              <div className="bg-card-background border-border space-y-3 rounded-lg border p-3">
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
            <div className="border-border rounded-lg border p-3">
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
              <p className="text-muted-foreground mb-4 text-center text-sm">
                {t("beFirstToReview")}
              </p>
              <div className="border-border rounded-lg border p-3">
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
