import {
  type AgentRatingStats,
  UserAgentRatingWithUser,
} from "@sokosumi/database";
import { getTranslations } from "next-intl/server";

import { AgentRatingForm } from "@/components/agents/agent-rating-form";
import { RatingDistribution } from "@/components/agents/rating-distribution";
import { StarRating } from "@/components/agents/star-rating";
import { Skeleton } from "@/components/ui/skeleton";

import { ReviewsList } from "./reviews-list";

interface AgentDetailReviewsProps {
  agentId: string;
  ratingStats: AgentRatingStats;
  distribution: Record<number, number>;
  ratingsWithComments: UserAgentRatingWithUser[];
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

  const hasRatings = ratingStats.totalRatings > 0;

  return (
    <div className="space-y-6">
      {/* Layout based on ratings existence */}
      {hasRatings ? (
        /* Two-panel layout when ratings exist */
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          {/* Left: Overall Rating, Distribution, and Rating Form */}
          <div className="space-y-6">
            {/* Header */}
            <div>
              <h3 className="mb-4 text-lg font-medium">
                {t("customerReviews")}
              </h3>
            </div>

            {/* Overall Rating */}
            <div>
              <StarRating
                averageRating={ratingStats.averageRating}
                totalRatings={ratingStats.totalRatings}
                size="lg"
              />
            </div>

            {/* Rating Distribution */}
            <div>
              <RatingDistribution
                distribution={distribution}
                totalRatings={ratingStats.totalRatings}
              />
            </div>

            {/* Write/Update Review */}
            <div>
              {canRate && (
                <AgentRatingForm
                  agentId={agentId}
                  existingRating={existingRating?.rating ?? null}
                  existingComment={existingRating?.comment ?? null}
                />
              )}
            </div>
          </div>

          {/* Right: Customer Reviews */}
          <div>
            <ReviewsList ratingsWithComments={ratingsWithComments} />
          </div>
        </div>
      ) : (
        /* Single layout when no ratings exist */
        <div>
          {canRate && (
            <div className="mx-auto max-w-md">
              <p className="text-muted-foreground mb-4 text-center text-sm">
                {t("beFirstToReview")}
              </p>
              <AgentRatingForm
                agentId={agentId}
                existingRating={existingRating?.rating ?? null}
                existingComment={existingRating?.comment ?? null}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AgentDetailReviewsSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="mb-4 h-6 w-32" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-20" />
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-5" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
