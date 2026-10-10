import { socialPostInteractions } from "@/helpers/social-post-engagement";
import type { SocialAccountMetric } from "@/schemas/social-account-statistics.schema";
import type { SocialPostMetrics } from "@/schemas/social-post-statistics.schema";

export const SOCIAL_PERFORMANCE_CONSISTENCY_DAYS = 365;
const DAY_MS = 86_400_000;

export interface ConsistencyPost {
  provider: string;
  publishedAt: Date | string | null;
  metrics: SocialPostMetrics;
  additionalMetrics?: SocialAccountMetric[];
}

export interface SocialPerformanceConsistency {
  from: string | null;
  until: string | null;
  daily: Array<{
    date: string;
    postCount: number;
    interactions: number | null;
  }>;
}

export const emptySocialPerformanceConsistency: SocialPerformanceConsistency = {
  from: null,
  until: null,
  daily: [],
};

export function consistencyLookbackStart(now = new Date()): Date {
  return new Date(
    now.getTime() - (SOCIAL_PERFORMANCE_CONSISTENCY_DAYS + 2) * DAY_MS,
  );
}

function utcDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function publishedAt(post: ConsistencyPost): Date | null {
  if (!post.publishedAt) return null;
  const value = new Date(post.publishedAt);
  return Number.isNaN(value.getTime()) ? null : value;
}

function dayInteractions(posts: ConsistencyPost[]): number | null {
  if (posts.length === 0) return 0;
  const measured = posts
    .map((post) => socialPostInteractions(post))
    .filter((value): value is number => value !== null);
  return measured.length === 0
    ? null
    : measured.reduce((total, value) => total + value, 0);
}

/** Cached posts only. Window is UTC days, independent of the page date filters. */
export function buildSocialPerformanceConsistency(input: {
  posts: ConsistencyPost[];
  now?: Date;
}): SocialPerformanceConsistency {
  const now = input.now ?? new Date();
  const end = utcDay(now);
  const cap = utcDay(
    new Date(now.getTime() - SOCIAL_PERFORMANCE_CONSISTENCY_DAYS * DAY_MS),
  );
  const byDay = new Map<string, ConsistencyPost[]>();
  for (const post of input.posts) {
    const published = publishedAt(post);
    if (!published) continue;
    const date = utcDay(published);
    if (date < cap || date > end) continue;
    const group = byDay.get(date) ?? [];
    group.push(post);
    byDay.set(date, group);
  }
  const from = [...byDay.keys()].sort()[0] ?? null;
  if (!from) return emptySocialPerformanceConsistency;
  const daily: SocialPerformanceConsistency["daily"] = [];
  for (
    let time = Date.parse(`${from}T00:00:00Z`);
    utcDay(new Date(time)) <= end;
    time += DAY_MS
  ) {
    const date = utcDay(new Date(time));
    const posts = byDay.get(date) ?? [];
    daily.push({
      date,
      postCount: posts.length,
      interactions: dayInteractions(posts),
    });
  }
  return { from, until: end, daily };
}
