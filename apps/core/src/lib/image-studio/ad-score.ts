export const AD_EVENT_WEIGHTS: Readonly<Record<string, number>> = {
  viewed_lightbox: 0.1,
  downloaded: 1,
  archived: 1,
  refined: 0.5,
  replaced_in_batch: -0.5,
  copied_to_files: 1,
  attached_to_post: 2,
  scheduled: 2,
  posted: 3,
  hidden: -2,
  deleted: -2,
  regenerated_same_brief: -0.5,
};

interface AdScoreInput {
  thumbsUp: number;
  thumbsDown: number;
  events: readonly { type: string; count: number }[];
  /** A normalized judge score can replace the neutral two-vote prior. */
  judgePrior?: number;
  /** Normalized pairwise results, supplied once comparisons are available. */
  pairwise?: { score: number; count: number };
}

/** Weighted positive/negative observations with a neutral Beta(1, 1) prior. */
export function scoreStudioAd({
  thumbsUp,
  thumbsDown,
  events,
  judgePrior = 0.5,
  pairwise,
}: AdScoreInput): number {
  let positive = thumbsUp + judgePrior * 2;
  let total = thumbsUp + thumbsDown + 2;
  for (const event of events) {
    const weight = AD_EVENT_WEIGHTS[event.type] ?? 0;
    positive += Math.max(weight, 0) * event.count;
    total += Math.abs(weight) * event.count;
  }
  if (pairwise) {
    positive += pairwise.score * pairwise.count;
    total += pairwise.count;
  }
  return positive / total;
}
