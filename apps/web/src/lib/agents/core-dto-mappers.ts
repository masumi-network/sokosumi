import type {
  Agent as CoreAgent,
  AgentMyReview as CoreAgentMyReview,
  AgentRatingDistribution as CoreAgentRatingDistribution,
  AgentReviews as CoreAgentReviews,
  Category as CoreCategory,
} from "@/lib/clients/generated/core";
import { SYNTHETIC_DEFAULT_CATEGORY } from "@/lib/constants/agent-categories";
import type { Category } from "@/lib/types/category";
import type { AgentRatingStats } from "@/lib/types/core-dto";

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

export function mapCoreCategoryToCategory(category: CoreCategory): Category {
  return {
    slug: category.slug,
    name: category.name,
    priority: category.priority,
    description: category.description ?? undefined,
    image: category.image ?? undefined,
    icon: category.icon ?? undefined,
    styles: category.styles ?? undefined,
  };
}

export function mapCoreAgentReviews(reviews: CoreAgentReviews) {
  return {
    ratingDistribution: mapCoreAgentRatingDistribution(reviews.distribution),
    ratingsWithComments: reviews.ratingsWithComments,
  };
}

export function mapCoreAgentRatingStatsMap(
  agents: CoreAgent[],
): Record<string, AgentRatingStats> {
  return Object.fromEntries(
    agents.map((agent) => [agent.id, agent.metrics.ratings]),
  );
}

export function mapCoreCategoriesToCategories(
  categories: CoreCategory[],
): Category[] {
  const mappedCategories = categories.map(mapCoreCategoryToCategory);
  const hasSyntheticDefaultCategory = mappedCategories.some(
    (category) => category.slug === SYNTHETIC_DEFAULT_CATEGORY.slug,
  );

  return hasSyntheticDefaultCategory
    ? mappedCategories
    : [...mappedCategories, SYNTHETIC_DEFAULT_CATEGORY];
}
