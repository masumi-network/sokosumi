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

export interface CalendarDay {
  /** YYYY-MM-DD, or null for the blank cells before the 1st. */
  date: string | null;
  day: number | null;
  entries: Entry[];
}

/** The month as Monday-first weeks, with each day's entries. */
export function monthGrid(month: string, calendar: Entry[]): CalendarDay[] {
  const [year, monthIndex] = month.split("-").map(Number) as [number, number];
  const first = new Date(Date.UTC(year, monthIndex - 1, 1));
  const days = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  const leading = (first.getUTCDay() + 6) % 7;
  const cells: CalendarDay[] = Array.from({ length: leading }, () => ({
    date: null,
    day: null,
    entries: [],
  }));
  for (let day = 1; day <= days; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    cells.push({
      date,
      day,
      entries: calendar.filter((entry) => entry.date === date),
    });
  }
  return cells;
}

/** "Mon 5 Oct", or "Today" / "Tomorrow" relative to `today` (YYYY-MM-DD). */
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
