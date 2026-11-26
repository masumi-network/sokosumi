import { CMO_CHANNELS, isCmoShortVideoFormat } from "./cmo-channels.js";
import type { CmoVolumeLevel } from "./cmo-plan-volume.js";
import {
  creditsPerTalkingVideoCents,
  TALKING_VIDEO_PLANNED_SCRIPT,
  TALKING_VIDEO_PRICE,
} from "./talking-video-credits.js";

/** The AI credits each CMO plan pays for a month (Starter, Growth, Scale). */
export const CMO_PLAN_CREDITS: Record<CmoVolumeLevel, number> = {
  steady: 10_000,
  active: 25_000,
  all_in: 50_000,
};

/** The share of a plan's credits kept for Cuso's own work and remakes. */
export const CMO_PLAN_CREDITS_KEPT = 0.3;

/**
 * What one piece of a month costs at most, in credits, before it is made: a
 * picture 4 (Muse Image is 1; prod averaged 2.9 a picture job over the 14
 * days to 2026-11-25, with remakes on stronger models), a short video 14, a
 * five-second video 21, and a talking video its longest script with the
 * site behind the presenter, B-roll and music.
 */
export const CMO_PIECE_CREDITS = {
  picture: 4,
  shortVideo: 14,
  video: 21,
  talkingVideo: creditsPerTalkingVideoCents(
    TALKING_VIDEO_PRICE,
    "x".repeat(TALKING_VIDEO_PLANNED_SCRIPT.longest),
    { siteShots: true, broll: true, music: true },
  ),
};

type Formats = Record<
  string,
  {
    image: boolean;
    video?: boolean;
    talking?: boolean;
    slides?: readonly [number, number];
  }
>;

/** The most one calendar entry costs, in credits; a copy on another network is free. */
export function cmoPieceCredits(channel: string, format: string): number {
  const key = channel.toLowerCase();
  const spec = (CMO_CHANNELS as Record<string, { formats: Formats }>)[key]
    ?.formats[format];
  if (!spec) return 0;
  if (spec.talking) return CMO_PIECE_CREDITS.talkingVideo;
  if (isCmoShortVideoFormat(key, format)) return CMO_PIECE_CREDITS.shortVideo;
  if (spec.video) return CMO_PIECE_CREDITS.video;
  if (spec.image) return CMO_PIECE_CREDITS.picture * (spec.slides?.[1] ?? 1);
  return 0;
}

/** The credits a month's pieces may spend: the plan's, less what Cuso keeps. */
export function cmoMonthPieceBudget(level: CmoVolumeLevel): number {
  return Math.floor(CMO_PLAN_CREDITS[level] * (1 - CMO_PLAN_CREDITS_KEPT));
}
