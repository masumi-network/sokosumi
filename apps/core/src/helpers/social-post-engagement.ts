import type { SocialPostMetrics } from "@/schemas/social-post-statistics.schema";

export interface SocialPostEngagementInput {
  provider: string;
  metrics: SocialPostMetrics;
  additionalMetrics?: Array<{
    key: string;
    value: number | null;
    period?: string | null;
    unit?: string | null;
  }>;
}

function reportsShares(provider: string): boolean {
  return provider !== "youtube";
}

function quoteCount(post: SocialPostEngagementInput): number | null {
  if (post.provider !== "x") return null;
  return (
    post.additionalMetrics?.find((metric) =>
      ["quote_count", "quotes"].includes(metric.key),
    )?.value ?? null
  );
}

/** Skip shares when the provider never reports them. Any other null numerator is unavailable. */
export function socialPostInteractions(
  post: SocialPostEngagementInput,
): number | null {
  const values: Array<number | null> = [
    post.metrics.likes,
    post.metrics.comments,
  ];
  if (reportsShares(post.provider) || post.metrics.shares !== null)
    values.push(post.metrics.shares);
  if (post.provider === "instagram") values.push(post.metrics.saves);
  if (post.provider === "x") values.push(quoteCount(post));
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export function socialPostEngagementRate(
  post: SocialPostEngagementInput,
): number | null {
  const numerator = socialPostInteractions(post);
  const exposure =
    post.provider === "x" || post.provider === "linkedin"
      ? post.metrics.impressions
      : post.metrics.views;
  return numerator !== null && exposure !== null && exposure > 0
    ? (100 * numerator) / exposure
    : null;
}

export function summarizeSocialPostEngagement(
  posts: SocialPostEngagementInput[],
) {
  const interactions = posts.map(socialPostInteractions);
  const measured = interactions.filter((value) => value !== null);
  return {
    postCount: posts.length,
    measuredInteractionCount: measured.length,
    interactions: measured.length
      ? measured.reduce((sum, value) => sum + value, 0)
      : null,
    engagementRates: posts.map(socialPostEngagementRate),
  };
}
