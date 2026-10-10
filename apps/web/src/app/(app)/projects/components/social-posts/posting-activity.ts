export interface ActivityDay {
  date: string;
  posts: number;
  engagement: number | null;
}

export type ActivityMode = "posts" | "engagement";

const LEVELS = 4;

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

/** Sunday-aligned weeks. Leading pad cells are null. */
export function calendarWeeks(days: ActivityDay[]): (ActivityDay | null)[][] {
  const filled = fillActivityRange(days);
  if (filled.length === 0) return [];
  const start = utcDate(filled[0]?.date ?? "");
  const pad = start.getUTCDay();
  const cells: (ActivityDay | null)[] = [
    ...Array.from({ length: pad }, () => null),
    ...filled,
  ];
  const weeks: (ActivityDay | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
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

function utcDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
