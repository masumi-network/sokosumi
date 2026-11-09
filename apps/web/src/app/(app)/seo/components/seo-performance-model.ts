import type { ProjectSeoMetric } from "@sokosumi/core-client";

/** Days in each compared window. */
export const SEO_COMPARE_DAYS = 7;
const DAY_MS = 86_400_000;

type Points = ProjectSeoMetric["points"];
type Window = { from: string; to: string };

function dayNumber(date: string) {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

/** A window counts only when every one of its days is reported; a missing day is not a zero. */
function complete(points: Points, days: Set<number>) {
  const reported = new Set(
    points
      .filter((point) => point.value !== null)
      .map((point) => dayNumber(point.date))
      .filter((day) => days.has(day)),
  );
  return reported.size === days.size;
}

function sum(points: Points, days: Set<number>) {
  if (!complete(points, days)) return null;
  let total = 0;
  for (const point of points)
    if (point.value !== null && days.has(dayNumber(point.date)))
      total += point.value;
  return total;
}

function windowDays(last: number) {
  const days = (end: number) =>
    new Set(Array.from({ length: SEO_COMPARE_DAYS }, (_, i) => end - i));
  return { current: days(last), previous: days(last - SEO_COMPARE_DAYS) };
}

function dateOf(day: number) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Impressions each week needs before a click-through rate or position change means anything. */
export const SEO_MIN_COMPARE_IMPRESSIONS = 100;

/**
 * Google rarely shows the pages: fewer impressions over the period than a comparison needs
 * for that many weeks. A period shorter than a week still needs one week's worth.
 */
export function seoRarelyShown(impressions: number, period: Window) {
  const days = dayNumber(period.to) - dayNumber(period.from) + 1;
  const weeks = Math.max(1, days / SEO_COMPARE_DAYS);
  return impressions < SEO_MIN_COMPARE_IMPRESSIONS * weeks;
}

/**
 * The 7 days up to the newest reported day against the 7 before, from one sync's
 * daily points. Counts are sums; CTR is clicks over impressions; position is
 * weighted by impressions, as Search Console weights it. A side is null unless
 * all 7 of its days are reported, so a gap never reads as a drop.
 */
export function seoWeekOverWeek(metrics: ProjectSeoMetric[]) {
  const byKey = new Map(metrics.map((metric) => [metric.key, metric.points]));
  const dates = metrics
    .flatMap((metric) => metric.points)
    .map((point) => dayNumber(point.date));
  if (!dates.length) return null;
  const last = Math.max(...dates);
  const windows = windowDays(last);
  const counts = (key: string) => {
    const points = byKey.get(key);
    return points
      ? {
          current: sum(points, windows.current),
          previous: sum(points, windows.previous),
        }
      : null;
  };
  const weighted = (key: string) => {
    const values = byKey.get(key);
    const weights = byKey.get("impressions");
    if (!values || !weights) return null;
    const known = (days: Set<number>) => complete(weights, days);
    const weightByDay = new Map(
      weights.map((point) => [dayNumber(point.date), point.value ?? 0]),
    );
    const average = (days: Set<number>) => {
      let total = 0;
      let weight = 0;
      for (const point of values) {
        const day = dayNumber(point.date);
        const impressions = weightByDay.get(day) ?? 0;
        if (point.value === null || !days.has(day) || impressions <= 0)
          continue;
        total += point.value * impressions;
        weight += impressions;
      }
      return known(days) && weight > 0 ? total / weight : null;
    };
    return {
      current: average(windows.current),
      previous: average(windows.previous),
    };
  };
  const shown = (
    value: { current: number | null; previous: number | null } | null,
  ) =>
    value && (value.current !== null || value.previous !== null) ? value : null;
  const clicks = counts("clicks");
  const impressions = counts("impressions");
  const rate = (side: "current" | "previous") =>
    clicks?.[side] != null && impressions?.[side]
      ? clicks[side] / impressions[side]
      : null;
  const window = (end: number): Window => ({
    from: dateOf(end - SEO_COMPARE_DAYS + 1),
    to: dateOf(end),
  });
  const values: Record<
    string,
    { current: number | null; previous: number | null } | null
  > = {
    clicks: shown(clicks),
    impressions: shown(impressions),
    ctr: byKey.has("ctr")
      ? shown({ current: rate("current"), previous: rate("previous") })
      : null,
    position: shown(weighted("position")),
  };
  if (Object.values(values).every((value) => value === null)) return null;
  return {
    current: window(last),
    previous: window(last - SEO_COMPARE_DAYS),
    values,
  };
}

/** Days in a window, both ends included. */
export function seoWindowDays(window: Window) {
  return dayNumber(window.to) - dayNumber(window.from) + 1;
}

/**
 * Each total against the same read over the equal window before the period.
 * A missing side gives no comparison. A rate or a position compares only when
 * Google showed the pages often enough in both windows.
 */
export function seoPeriodChange(metrics: ProjectSeoMetric[]) {
  const impressions = metrics.find((metric) => metric.key === "impressions");
  const busy = (value: number | null | undefined, window: Window) =>
    value != null && !seoRarelyShown(value, window);
  const ratesCompare = Boolean(
    impressions?.previous &&
      busy(impressions.value, impressions) &&
      busy(impressions.previous.value, impressions.previous),
  );
  const changes = new Map<string, { previous: number; days: number }>();
  for (const metric of metrics) {
    const before = metric.previous;
    if (
      !before ||
      before.value === null ||
      metric.value === null ||
      metric.coverage === "unavailable"
    )
      continue;
    if ((metric.key === "ctr" || metric.key === "position") && !ratesCompare)
      continue;
    changes.set(metric.id, {
      previous: before.value,
      days: seoWindowDays(before),
    });
  }
  return changes;
}
