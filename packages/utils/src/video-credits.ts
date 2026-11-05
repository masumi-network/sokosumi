/**
 * What one generated video costs, from hand-verified per-second list prices.
 *
 * Shared for the same reason as `creditsPerImageCents`: the composer's estimate,
 * the quote written at submit and the debit taken on delivery must be one number.
 *
 * Only a per-resolution figure a person read off fal's model page is billed.
 * fal's pricing API reports one number per endpoint, and for video that number is
 * the cheapest resolution tier rather than the default one — `minimax/h3-max`
 * lists $0.0325/s while its default 768P costs $0.052/s — so billing it would
 * undercharge every default generation.
 *
 * 1 credit = 1 cent, and there is no markup on fal's list price.
 */

export interface VideoPriceFigures {
  /** USD per second by provider resolution value, hand-verified. */
  perSecondUsd?: Partial<Record<string, number>> | null;
}

export interface VideoLength {
  resolution: string;
  durationSeconds: number;
}

/** Credits (= cents) for one video, or null when no verified figure covers it. */
export function creditsPerVideoCents(
  price: VideoPriceFigures,
  video: VideoLength,
): number | null {
  const perSecond = price.perSecondUsd?.[video.resolution];
  if (typeof perSecond !== "number" || !Number.isFinite(perSecond)) return null;
  if (perSecond < 0) return null;
  if (!Number.isFinite(video.durationSeconds) || video.durationSeconds <= 0)
    return null;
  return Math.ceil(perSecond * video.durationSeconds * 100);
}
