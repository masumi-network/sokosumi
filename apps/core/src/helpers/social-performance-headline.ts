import { socialPostInteractions } from "@/helpers/social-post-engagement";

export interface HeadlinePost {
  provider: HeadlineProvider;
  publishedAt: Date | string | null;
  metrics: {
    views: number | null;
    impressions: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
  };
  additionalMetrics: Array<{ key: string; value: number | null }>;
}

export type HeadlineProvider =
  | "x"
  | "instagram"
  | "facebook"
  | "linkedin"
  | "tiktok"
  | "youtube";

export interface HeadlineTotals {
  postCount: number;
  views: number | null;
  impressions: number | null;
  interactions: number | null;
}

export interface SocialPerformanceHeadline {
  current: HeadlineTotals;
  previous: HeadlineTotals;
  deltas: {
    postCount: number | null;
    views: number | null;
    impressions: number | null;
    interactions: number | null;
  };
  daily: Array<HeadlineTotals & { date: string }>;
}

const EMPTY_TOTALS: HeadlineTotals = {
  postCount: 0,
  views: null,
  impressions: null,
  interactions: null,
};
const DAY_MS = 86_400_000;
const MAX_DAYS = 366;

function publishedAt(post: HeadlinePost): Date | null {
  if (!post.publishedAt) return null;
  const value = new Date(post.publishedAt);
  return Number.isNaN(value.getTime()) ? null : value;
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function eachUtcDay(from: Date, until: Date): string[] {
  const start = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate(),
  );
  const end = Date.UTC(
    until.getUTCFullYear(),
    until.getUTCMonth(),
    until.getUTCDate(),
  );
  if (end < start || end - start >= MAX_DAYS * DAY_MS) return [];
  const days: string[] = [];
  for (let time = start; time <= end; time += DAY_MS) {
    days.push(new Date(time).toISOString().slice(0, 10));
  }
  return days;
}

function sum(values: Array<number | null>): number | null {
  const measured = values.filter((value): value is number => value !== null);
  return measured.length === 0
    ? null
    : measured.reduce((total, value) => total + value, 0);
}

function absoluteDelta(current: number | null, previous: number | null) {
  return current !== null && previous !== null ? current - previous : null;
}

/** Same numerator as the calendar and post cards. YouTube omits shares. */
export function postInteractions(post: HeadlinePost): number | null {
  return socialPostInteractions(post);
}

function totals(posts: HeadlinePost[]): HeadlineTotals {
  return {
    postCount: posts.length,
    views: sum(posts.map((post) => post.metrics.views)),
    impressions: sum(posts.map((post) => post.metrics.impressions)),
    interactions: sum(posts.map(postInteractions)),
  };
}

function inRange(post: HeadlinePost, from: Date, until: Date) {
  const published = publishedAt(post);
  return published !== null && published >= from && published <= until;
}

export function buildSocialPerformanceHeadline(input: {
  posts: HeadlinePost[];
  publishedFrom?: Date;
  publishedUntil?: Date;
}): SocialPerformanceHeadline {
  const ranged = Boolean(input.publishedFrom && input.publishedUntil);
  const from = input.publishedFrom;
  const until = input.publishedUntil;
  const duration = from && until ? until.getTime() - from.getTime() + 1 : null;
  const previousFrom =
    from && duration !== null ? new Date(from.getTime() - duration) : null;
  const previousUntil =
    from && duration !== null ? new Date(from.getTime() - 1) : null;
  const currentPosts =
    from && until
      ? input.posts.filter((post) => inRange(post, from, until))
      : input.posts;
  const previousPosts =
    previousFrom && previousUntil
      ? input.posts.filter((post) => inRange(post, previousFrom, previousUntil))
      : [];
  const current = totals(currentPosts);
  const previous = totals(previousPosts);
  const publishedDays = currentPosts.flatMap((post) => {
    const published = publishedAt(post);
    return published ? [published] : [];
  });
  const earliest = publishedDays.reduce<Date | undefined>(
    (first, published) => (!first || published < first ? published : first),
    undefined,
  );
  const latest = publishedDays.reduce<Date | undefined>(
    (last, published) => (!last || published > last ? published : last),
    undefined,
  );
  const dailyDays =
    ranged && from && until
      ? eachUtcDay(from, until)
      : earliest && latest
        ? eachUtcDay(earliest, latest)
        : [];
  const byDay = new Map<string, HeadlinePost[]>();
  for (const post of currentPosts) {
    const published = publishedAt(post);
    if (!published) continue;
    const day = utcDay(published);
    const group = byDay.get(day) ?? [];
    group.push(post);
    byDay.set(day, group);
  }
  return {
    current,
    previous: ranged ? previous : EMPTY_TOTALS,
    deltas: ranged
      ? {
          postCount: absoluteDelta(current.postCount, previous.postCount),
          views: absoluteDelta(current.views, previous.views),
          impressions: absoluteDelta(current.impressions, previous.impressions),
          interactions: absoluteDelta(
            current.interactions,
            previous.interactions,
          ),
        }
      : {
          postCount: null,
          views: null,
          impressions: null,
          interactions: null,
        },
    daily: dailyDays.map((date) => ({
      date,
      ...totals(byDay.get(date) ?? []),
    })),
  };
}

export const emptySocialPerformanceHeadline: SocialPerformanceHeadline = {
  current: EMPTY_TOTALS,
  previous: EMPTY_TOTALS,
  deltas: {
    postCount: null,
    views: null,
    impressions: null,
    interactions: null,
  },
  daily: [],
};
