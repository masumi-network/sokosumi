import { searchConsoleDay } from "@/lib/seo/native-statistics";

const DAY_MS = 86_400_000;
const WEEK_DAYS = 7;
/** The impact worker compares this many whole weeks after the crawl (seo-bot WINDOW_WEEKS). */
export const IMPACT_WINDOW_WEEKS = 4;
/** Search Console data for a day is final this many days later (seo-bot FINAL_LAG_DAYS). */
export const IMPACT_FINAL_LAG_DAYS = 7;

function dayNumber(date: string) {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

function dateOf(day: number) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The compared weeks, as Search Console dates. The window starts on the first
 * day after the crawl day that falls on the change day's weekday, so the gap is
 * whole weeks (seo-bot s6Series). The caller passes a crawl after the change.
 */
export function impactWindow(changedAt: Date, crawledAt: Date) {
  const changeDay = dayNumber(searchConsoleDay(changedAt));
  const crawlDay = dayNumber(searchConsoleDay(crawledAt));
  const start =
    changeDay + WEEK_DAYS * Math.ceil((crawlDay + 1 - changeDay) / WEEK_DAYS);
  return {
    windowStart: dateOf(start),
    windowEnd: dateOf(start + IMPACT_WINDOW_WEEKS * WEEK_DAYS - 1),
  };
}

/** The day Search Console data for the whole window is final. */
export function impactWindowReadyOn(windowEnd: string) {
  return dateOf(dayNumber(windowEnd) + IMPACT_FINAL_LAG_DAYS);
}
