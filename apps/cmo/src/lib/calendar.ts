import type { CmoOverview } from "@sokosumi/core-client";

type Entry = NonNullable<CmoOverview["strategy"]>["calendar"][number];

/** How the calendar marks an entry; the legend uses the same kinds. */
export type CalendarKind = "post" | "ad" | "article" | "news";

export function calendarKind(
  entry: Pick<Entry, "format" | "channel">,
): CalendarKind {
  const text = `${entry.format} ${entry.channel}`.toLowerCase();
  if (/\bad\b|ads|sponsored/.test(text)) return "ad";
  if (/newsletter|email/.test(text)) return "news";
  if (/article|blog|seo|website/.test(text)) return "article";
  return "post";
}

/** Social networks Sokosumi publishes to; everything else is plan only. */
export const SOCIAL_PROVIDERS = [
  "x",
  "linkedin",
  "instagram",
  "facebook",
  "tiktok",
  "youtube",
] as const;

/**
 * Whether Cuso can execute an entry now: it must be on a connected social
 * account. Otherwise it says why it stays in the plan.
 */
export function entryReadiness(
  channel: string,
  connected: readonly string[],
): "ready" | "connect" | "soon" {
  if (connected.includes(channel)) return "ready";
  return (SOCIAL_PROVIDERS as readonly string[]).includes(channel)
    ? "connect"
    : "soon";
}

const DAY_MS = 86_400_000;

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A plan day as people read it: { day: "numeric", month: "short" } → "9 Nov". */
export function formatDay(
  iso: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return utcDate(iso).toLocaleDateString("en-GB", {
    ...options,
    timeZone: "UTC",
  });
}

/**
 * Monday-first weeks from the first entry's week to the last entry's, at
 * least four and at most six. A plan starting on 27 October runs into
 * November, so weeks, not a calendar month, frame it.
 */
export function planWeeks(
  calendar: Pick<Entry, "date">[],
): { start: string; days: string[] }[] {
  const dates = calendar.map((entry) => entry.date).sort();
  const first = dates[0] ?? isoDay(new Date());
  const last = dates.at(-1) ?? first;
  const start = utcDate(first);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const weeks: { start: string; days: string[] }[] = [];
  for (
    let cursor = start.getTime();
    weeks.length < 4 || cursor <= utcDate(last).getTime();
    cursor += 7 * DAY_MS
  ) {
    const days = Array.from({ length: 7 }, (_, index) =>
      isoDay(new Date(cursor + index * DAY_MS)),
    );
    weeks.push({ start: days[0] ?? "", days });
    if (weeks.length >= 6) break;
  }
  return weeks;
}

/** "27 Oct to 21 Nov": the days the plan covers. */
export function planRange(calendar: Pick<Entry, "date">[]): string | null {
  const dates = calendar.map((entry) => entry.date).sort();
  const first = dates[0];
  const last = dates.at(-1);
  if (!first || !last) return null;
  const short = { day: "numeric", month: "short" } as const;
  return `${formatDay(first, short)} to ${formatDay(last, short)}`;
}

/** Social posts a week across the plan, which is what a CMO tier limits. */
export function socialPostsPerWeek(calendar: Entry[]): number {
  const social = calendar.filter(
    (entry) =>
      (SOCIAL_PROVIDERS as readonly string[]).includes(entry.channel) &&
      entry.status !== "skipped",
  );
  if (social.length === 0) return 0;
  const dates = social.map((entry) => entry.date).sort();
  const days =
    (utcDate(dates.at(-1) ?? "").getTime() -
      utcDate(dates[0] ?? "").getTime()) /
      DAY_MS +
    1;
  return social.length / Math.ceil(days / 7);
}

/** "Mon 5 Oct", or "Today" / "Tomorrow" relative to `today` (YYYY-MM-DD). */
const CHANNEL_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  x: "X",
  twitter: "X",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  threads: "Threads",
  bluesky: "Bluesky",
  pinterest: "Pinterest",
  website: "Website",
  seo: "Website",
  email: "Newsletter",
  newsletter: "Newsletter",
  ads: "Ads",
  meta: "Meta ads",
  google: "Google ads",
};

/** A channel id as people write it: "linkedin" reads "LinkedIn". */
export function channelLabel(channel: string): string {
  const key = channel.trim().toLowerCase();
  return CHANNEL_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
}

export function relativeDay(date: string, today: string): string {
  const days = Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
