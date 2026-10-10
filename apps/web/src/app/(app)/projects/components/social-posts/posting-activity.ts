export interface ActivityDay {
  date: string;
  posts: number;
  engagement: number | null;
}

export type ActivityMode = "posts" | "engagement";

export interface CalendarCell {
  date: string;
  posts: number;
  engagement: number | null;
  /** False outside the daily series. Those cells are blank and uncounted. */
  inRange: boolean;
}

const LEVELS = 4;
/** GitHub-style year: 53 Sunday-start weeks ending on the series' last day. */
export const CONTRIBUTION_WEEKS = 53;
const SPARKLINE_DAILY_LIMIT = 16;
const SPARKLINE_BUCKET_DAYS = 7;

export function fillActivityRange(days: ActivityDay[]): ActivityDay[] {
  if (days.length === 0) return [];
  const sorted = days.toSorted((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(sorted.map((day) => [day.date, day]));
  const start = utcDate(sorted[0]?.date ?? "");
  const end = utcDate(sorted.at(-1)?.date ?? "");
  const filled: ActivityDay[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    const date = cursor.toISOString().slice(0, 10);
    filled.push(byDate.get(date) ?? { date, posts: 0, engagement: null });
  }
  return filled;
}

/** Post and active-day totals for the publication-range series only. */
export function activityTotals(days: ActivityDay[]): {
  posts: number;
  active: number;
} {
  let posts = 0;
  let active = 0;
  for (const day of fillActivityRange(days)) {
    posts += day.posts;
    if (day.posts > 0) active += 1;
  }
  return { posts, active };
}

export function postingStreaks(days: ActivityDay[]): {
  current: number;
  longest: number;
} {
  const filled = fillActivityRange(days);
  let longest = 0;
  let run = 0;
  for (const day of filled) {
    if (day.posts > 0) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }
  let current = 0;
  for (let index = filled.length - 1; index >= 0; index -= 1) {
    if ((filled[index]?.posts ?? 0) > 0) current += 1;
    else break;
  }
  return { current, longest };
}

/**
 * Fixed recent window, not the publication span. Days outside the series stay
 * blank so a short range does not invent a year of posts.
 */
export function contributionCalendar(
  days: ActivityDay[],
  weeks = CONTRIBUTION_WEEKS,
): CalendarCell[][] {
  const filled = fillActivityRange(days);
  const rangeStart = filled[0]?.date;
  const rangeEnd = filled.at(-1)?.date;
  if (!rangeStart || !rangeEnd || weeks <= 0) return [];
  const endSunday = addDays(utcDate(rangeEnd), -utcDate(rangeEnd).getUTCDay());
  const startSunday = addDays(endSunday, -(weeks - 1) * 7);
  const byDate = new Map(filled.map((day) => [day.date, day]));
  const columns: CalendarCell[][] = [];
  for (let week = 0; week < weeks; week += 1) {
    const column: CalendarCell[] = [];
    for (let row = 0; row < 7; row += 1) {
      const date = addDays(startSunday, week * 7 + row)
        .toISOString()
        .slice(0, 10);
      const inRange = date >= rangeStart && date <= rangeEnd;
      const day = inRange ? byDate.get(date) : undefined;
      column.push({
        date,
        posts: day?.posts ?? 0,
        engagement: inRange ? (day?.engagement ?? null) : null,
        inRange,
      });
    }
    columns.push(column);
  }
  return columns;
}

/** Week columns whose cells include the 1st, skipping labels closer than 2 weeks. */
export function calendarMonthStarts(weeks: CalendarCell[][]): number[] {
  const indexes: number[] = [];
  for (let index = 0; index < weeks.length; index += 1) {
    if (!weeks[index]?.some((cell) => cell.date.endsWith("-01"))) continue;
    const previous = indexes.at(-1);
    if (previous != null && index - previous < 2) continue;
    indexes.push(index);
  }
  return indexes;
}

export function activityLevel(
  day: ActivityDay,
  mode: ActivityMode,
  max: number,
): number | null {
  const value = mode === "posts" ? day.posts : day.engagement;
  if (value == null) return null;
  if (value <= 0 || max <= 0) return 0;
  return Math.min(LEVELS, Math.ceil((value / max) * LEVELS));
}

export function activityMax(days: ActivityDay[], mode: ActivityMode): number {
  let max = 0;
  for (const day of days) {
    const value = mode === "posts" ? day.posts : day.engagement;
    if (value != null && value > max) max = value;
  }
  return max;
}

/** Daily points when the range is short; weekly sums when it is long. */
export function sparklineSeries(values: (number | null)[]): (number | null)[] {
  if (values.length <= SPARKLINE_DAILY_LIMIT) return values;
  const buckets: (number | null)[] = [];
  for (let index = 0; index < values.length; index += SPARKLINE_BUCKET_DAYS) {
    const slice = values.slice(index, index + SPARKLINE_BUCKET_DAYS);
    let sum = 0;
    let measured = false;
    for (const value of slice) {
      if (value == null) continue;
      measured = true;
      sum += value;
    }
    buckets.push(measured ? sum : null);
  }
  return buckets;
}

function utcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
