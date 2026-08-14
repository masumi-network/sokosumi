import type {
  AgentMyReview as CoreAgentMyReview,
  AgentRatingDistribution as CoreAgentRatingDistribution,
  AgentReviews as CoreAgentReviews,
} from "@/lib/clients/generated/core";

/** The caller's own rating for an agent; consumers only need rating + comment. */
export interface UserAgentRatingSummary {
  rating: number;
  comment: string | null;
}

export function mapCoreAgentRatingDistribution(
  distribution: CoreAgentRatingDistribution,
): Record<number, number> {
  return {
    1: distribution[1] ?? 0,
    2: distribution[2] ?? 0,
    3: distribution[3] ?? 0,
    4: distribution[4] ?? 0,
    5: distribution[5] ?? 0,
  };
}

export function mapCoreMyAgentReview(
  review: CoreAgentMyReview,
): UserAgentRatingSummary | null {
  if (!review) {
    return null;
  }

  return {
    rating: review.rating,
    comment: review.comment ?? null,
  };
}

export function mapCoreAgentReviews(reviews: CoreAgentReviews) {
  return {
    ratingDistribution: mapCoreAgentRatingDistribution(reviews.distribution),
    ratingsWithComments: reviews.ratingsWithComments,
  };
}
