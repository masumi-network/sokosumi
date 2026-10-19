import { socialPostInteractions } from "@/helpers/social-post-engagement";
import type { SocialAccountMetric } from "@/schemas/social-account-statistics.schema";
import type { SocialPostMetrics } from "@/schemas/social-post-statistics.schema";

export const SUGGESTED_TIMES_LOOKBACK_DAYS = 90;
export const SUGGESTED_TIMES_MIN_SCORED_POSTS = 8;
export const SUGGESTED_TIMES_MIN_HOUR_POSTS = 2;
export const SUGGESTED_TIMES_MIN_HOURS = 2;
export const SUGGESTED_TIMES_MAX_HOURS = 3;

const DAY_MS = 86_400_000;

export interface SuggestedTimesPost {
  provider: string;
  publishedAt: Date | string | null;
  metrics: SocialPostMetrics;
  additionalMetrics?: SocialAccountMetric[];
}

export function suggestedTimesLookbackStart(now = new Date()): Date {
  return new Date(now.getTime() - SUGGESTED_TIMES_LOOKBACK_DAYS * DAY_MS);
}

function publishedAt(post: SuggestedTimesPost): Date | null {
  if (!post.publishedAt) return null;
  const value = new Date(post.publishedAt);
  return Number.isNaN(value.getTime()) ? null : value;
}

/** Wall-clock hour 0–23 in `timezone`. Invalid zones or unreadable hours drop. */
function hourInTimezone(date: Date, timezone: string): number | null {
  try {
    const hour = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone: timezone,
    })
      .formatToParts(date)
      .find((part) => part.type === "hour")?.value;
    if (hour === undefined) return null;
    const value = Number(hour);
    return Number.isInteger(value) && value >= 0 && value <= 23 ? value : null;
  } catch {
    return null;
  }
}

/**
 * Hours that already earned engagement for this account. Empty when history
 * is too thin to pick two hours.
 */
export function suggestBestPostingTimes(input: {
  posts: SuggestedTimesPost[];
  timezone: string;
  now?: Date;
}): number[] {
  const now = input.now ?? new Date();
  const from = suggestedTimesLookbackStart(now).getTime();
  const until = now.getTime();
  const byHour = new Map<number, { total: number; postCount: number }>();
  let scored = 0;
  for (const post of input.posts) {
    const published = publishedAt(post);
    if (!published) continue;
    const time = published.getTime();
    if (time < from || time > until) continue;
    const hour = hourInTimezone(published, input.timezone);
    if (hour === null) continue;
    const interactions = socialPostInteractions(post);
    if (interactions === null) continue;
    scored += 1;
    const bucket = byHour.get(hour) ?? { total: 0, postCount: 0 };
    bucket.total += interactions;
    bucket.postCount += 1;
    byHour.set(hour, bucket);
  }
  if (scored < SUGGESTED_TIMES_MIN_SCORED_POSTS) return [];
  const hours = [...byHour.entries()]
    .filter(([, bucket]) => bucket.postCount >= SUGGESTED_TIMES_MIN_HOUR_POSTS)
    .toSorted((left, right) => {
      const leftAvg = left[1].total / left[1].postCount;
      const rightAvg = right[1].total / right[1].postCount;
      return (
        rightAvg - leftAvg ||
        right[1].postCount - left[1].postCount ||
        left[0] - right[0]
      );
    })
    .map(([hour]) => hour)
    .slice(0, SUGGESTED_TIMES_MAX_HOURS);
  return hours.length >= SUGGESTED_TIMES_MIN_HOURS ? hours : [];
}
