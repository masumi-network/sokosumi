import {
  type SocialPostEngagementInput,
  socialPostEngagementRate,
  socialPostInteractions,
} from "@/helpers/social-post-engagement";

export interface StrongSocialAccountPostCandidate
  extends SocialPostEngagementInput {
  id: string;
}

/** Top quarter of measured rates, and only posts with at least one interaction. */
export function strongSocialAccountPostIds(
  posts: readonly StrongSocialAccountPostCandidate[],
): Set<string> {
  const measured = posts.flatMap((post) => {
    const rate = socialPostEngagementRate(post);
    const interactions = socialPostInteractions(post);
    if (rate === null || interactions === null || interactions <= 0) return [];
    return [{ id: post.id, rate }];
  });
  if (measured.length === 0) return new Set();
  const ranked = measured.toSorted((left, right) => left.rate - right.rate);
  const winnerCount = Math.max(1, Math.ceil(ranked.length * 0.25));
  const cutoff = ranked[ranked.length - winnerCount]?.rate ?? 0;
  return new Set(
    ranked.filter((post) => post.rate >= cutoff).map((post) => post.id),
  );
}
