import type { ProjectSeoMetric } from "@sokosumi/core-client";

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
export function savedSeoStatistics(metrics: ProjectSeoMetric[]) {
  return latestSeoMeasurements(metrics).find((metric) => metric.propertyId);
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
