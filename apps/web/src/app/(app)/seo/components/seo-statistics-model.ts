import type { ProjectSeoMetric } from "@sokosumi/core-client";
import { seoStatisticsLostData } from "@sokosumi/utils";

export const SEO_STATISTICS_PERIODS = [7, 28, 90] as const;
export const SEO_DEFAULT_STATISTICS_DAYS = 28;
const MILLISECONDS_PER_DAY = 86_400_000;
const MAX_STATISTICS_DAYS = 366;

export type SeoStatisticsProvider = "ga4" | "search_console";

function newestFirst(left: ProjectSeoMetric, right: ProjectSeoMetric) {
  return (
    new Date(right.observedAt).getTime() - new Date(left.observedAt).getTime()
  );
}

/** Keep the latest saved snapshot for each source, without adding overlapping totals. */
export function latestSeoMeasurements(metrics: ProjectSeoMetric[]) {
  const sorted = [...metrics].sort(newestFirst);
  const selected = new Map<string, ProjectSeoMetric>();
  for (const metric of sorted) {
    if (metric.source !== "ga4" && metric.source !== "search_console") continue;
    const group = selected.get(metric.source);
    if (!group) selected.set(metric.source, metric);
  }
  return sorted.filter((metric) => {
    const group = selected.get(metric.source);
    return (
      group &&
      metric.propertyId === group.propertyId &&
      metric.from === group.from &&
      metric.to === group.to &&
      metric.channel === group.channel &&
      new Date(metric.observedAt).getTime() ===
        new Date(group.observedAt).getTime()
    );
  });
}

/** Saved metrics already belong to the current reader and selected pages. */
export function savedSeoStatistics(
  metrics: ProjectSeoMetric[],
  source?: SeoStatisticsProvider,
) {
  return latestSeoMeasurements(metrics).find(
    (metric) => metric.propertyId && (!source || metric.source === source),
  );
}

export function seoStatisticsPeriod(days: number, now = new Date()) {
  const until = new Date(now);
  until.setUTCDate(until.getUTCDate() - 1);
  const from = new Date(until);
  from.setUTCDate(from.getUTCDate() - days + 1);
  return {
    from: from.toISOString().slice(0, 10),
    to: until.toISOString().slice(0, 10),
  };
}

export function invalidSeoStatisticsPeriod(from: string, to: string) {
  const days = (Date.parse(to) - Date.parse(from)) / MILLISECONDS_PER_DAY;
  return (
    !from ||
    !to ||
    !Number.isFinite(days) ||
    days < 0 ||
    days >= MAX_STATISTICS_DAYS
  );
}

/**
 * Whether a sync's coverage is worth a badge. Search Console is always partial,
 * because Google hides rare searches; that alone is not news. A Search Console
 * sync is flagged only when it stored a note about lost data.
 */
export function seoCoverageIsNews(metric: {
  source: string;
  coverage: string;
  notes: string[];
}) {
  if (metric.coverage === "unavailable") return true;
  if (metric.coverage !== "partial") return false;
  return (
    metric.source !== "search_console" || seoStatisticsLostData(metric.notes)
  );
}

/** The first and last day with a value. Google reports a few days late, so this can end before the requested period. */
export function seoReportedPeriod(metrics: Pick<ProjectSeoMetric, "points">[]) {
  const days = metrics
    .flatMap((metric) => metric.points)
    .filter((point) => point.value !== null)
    .map((point) => point.date)
    .sort();
  return days.length ? { from: days[0], to: days.at(-1) as string } : null;
}

/**
 * The days behind the saved search rows. Totals saved by the same sync share their read,
 * so they also share the days Google reported. Metric ids are "<sync id>:<metric key>".
 */
export function seoQueryPeriod(
  source: { observationId: string; from: string; to: string },
  metrics: ProjectSeoMetric[],
) {
  const sameRead = metrics.filter(
    (metric) =>
      metric.source === "search_console" &&
      metric.id.split(":")[0] === source.observationId,
  );
  // Only the end moves: Google leaves out quiet days, so the first day with data is not the start.
  const reported = seoReportedPeriod(sameRead);
  return { from: source.from, to: reported?.to ?? source.to };
}

/** Open the chart on the count with the most active days, so sparse clicks do not hide a moving trend. */
export function seoDefaultMetric<
  Metric extends Pick<ProjectSeoMetric, "unit" | "points">,
>(metrics: Metric[]) {
  const activeDays = (metric: Metric) =>
    metric.points.filter((point) => (point.value ?? 0) > 0).length;
  let best: Metric | undefined;
  for (const metric of metrics)
    if (
      metric.unit === "count" &&
      (!best || activeDays(metric) > activeDays(best))
    )
      best = metric;
  return best ?? metrics[0];
}

/** Google search totals for the selected pages and the days Google reported, or null before both counts exist. */
export function seoSearchTraffic(metrics: ProjectSeoMetric[]) {
  const search = latestSeoMeasurements(metrics).filter(
    (metric) => metric.source === "search_console",
  );
  const total = (key: string) => {
    const metric = search.find((item) => item.key === key);
    return metric && metric.coverage !== "unavailable" ? metric.value : null;
  };
  const impressions = total("impressions");
  const clicks = total("clicks");
  const period = seoReportedPeriod(search);
  return impressions === null || clicks === null || !period
    ? null
    : { impressions, clicks, period };
}
