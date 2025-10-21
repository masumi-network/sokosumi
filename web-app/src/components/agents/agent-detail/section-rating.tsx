import { getTranslations } from "next-intl/server";

import { AgentRatingForm } from "@/components/agents/agent-rating-form";
import { RatingDistribution } from "@/components/agents/rating-distribution";
import { RatingListItem } from "@/components/agents/rating-list-item";
import { StarRating } from "@/components/agents/star-rating";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentRatingStats,
  UserAgentRatingWithUser,
} from "@/lib/db/repositories/agentRating.repository";

interface AgentDetailRatingSectionProps {
  agentId: string;
  ratingStats: AgentRatingStats;
  distribution: Record<number, number>;
  ratingsWithComments: UserAgentRatingWithUser[];
  canRate: boolean;
  existingRating: {
    rating: number;
    comment: string | null;
  } | null;
  authContext: {
    userId: string | null;
  } | null;
}

export async function AgentDetailRatingSection({
  agentId,
  ratingStats,
  distribution,
  ratingsWithComments,
  canRate,
  existingRating,
  authContext,
}: AgentDetailRatingSectionProps) {
  const t = await getTranslations("Components.Agents.Rating");

  const hasRatings = ratingStats.totalRatings > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="mb-4 text-lg font-medium">{t("customerReviews")}</h3>
        {!hasRatings && (
          <p className="text-muted-foreground">{t("noRatings")}</p>
        )}
      </div>

      {/* Amazon-style Layout */}
      {hasRatings && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: Overall Rating, Distribution, and Rating Form */}
          <div className="space-y-6">
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
              {canRate ? (
                <AgentRatingForm
                  agentId={agentId}
                  existingRating={existingRating?.rating ?? null}
                  existingComment={existingRating?.comment ?? null}
                />
              ) : (
                <div className="py-8 text-center">
                  <p className="text-muted-foreground mb-4 text-sm">
                    {authContext?.userId
                      ? t("eligibilityMessage")
                      : t("signInToReview")}
                  </p>
                  {!authContext?.userId && (
                    <Button variant="outline" className="w-full">
                      {t("signIn")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: Customer Reviews */}
          <div>
            {ratingsWithComments.length > 0 ? (
              <div className="space-y-4">
                {ratingsWithComments.slice(0, 5).map((rating) => (
                  <RatingListItem key={rating.id} rating={rating} />
                ))}
                {ratingsWithComments.length > 5 && (
                  <Button variant="outline" className="mt-4 w-full">
                    {t("viewAllReviews")}
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">
                {t("noReviewsYet")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentDetailRatingSectionSkeleton() {
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
