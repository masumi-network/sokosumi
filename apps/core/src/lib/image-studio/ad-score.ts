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
}

/** Weighted positive/negative observations with a neutral Beta(1, 1) prior. */
export function scoreStudioAd({
  thumbsUp,
  thumbsDown,
  events,
}: AdScoreInput): number {
  let positive = thumbsUp + 1;
  let total = thumbsUp + thumbsDown + 2;
  for (const event of events) {
    const weight = AD_EVENT_WEIGHTS[event.type] ?? 0;
    positive += Math.max(weight, 0) * event.count;
    total += Math.abs(weight) * event.count;
  }
  return positive / total;
}
