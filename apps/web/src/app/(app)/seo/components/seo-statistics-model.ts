import type {
  ProjectSeoMetric,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { seoStatisticsLostData } from "@sokosumi/utils";

/**
 * The days every sync reads; the reader does not choose a range. A quarter gives the trend a
 * line, and the equal window before it is still inside the 16 months Search Console keeps, so
 * Core can compare the totals with the quarter before.
 */
export const SEO_DEFAULT_STATISTICS_DAYS = 90;
/** A Search Console property for a whole domain starts with this. */
const SEARCH_DOMAIN_PROPERTY = "sc-domain:";
/** A domain property covers every address of the site, so it beats an address-prefix property. */
const DOMAIN_PROPERTY_RANK = 10_000;

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

/** The preset whose dates these are, so its button shows as chosen. Null for other dates. */
/**
 * The property that holds the audit's page, so the reader does not choose among several.
 * Search Console names a property by its domain or by an address prefix: the closest one wins.
 * Google Analytics names a property freely: one name with the page's host counts.
 * No match, or two equal matches: no guess, and the reader chooses.
 */
export function seoMatchingProperty(
  provider: SeoStatisticsProvider,
  properties: readonly { id: string; name: string }[],
  pageUrl: string | undefined,
): string {
  if (properties.length === 1) return properties[0].id;
  let page: URL;
  try {
    page = new URL(pageUrl ?? "");
  } catch {
    return "";
  }
  const host = page.hostname.replace(/^www\./, "");
  const rank = (property: { id: string; name: string }) => {
    if (provider === "ga4")
      return property.name.toLowerCase().includes(host) ? 1 : 0;
    if (property.id.startsWith(SEARCH_DOMAIN_PROPERTY)) {
      const domain = property.id
        .slice(SEARCH_DOMAIN_PROPERTY.length)
        .toLowerCase();
      return host === domain || host.endsWith(`.${domain}`)
        ? DOMAIN_PROPERTY_RANK + domain.length
        : 0;
    }
    return page.href.startsWith(property.id) ? property.id.length : 0;
  };
  let best = "";
  let bestRank = 0;
  let tied = false;
  for (const property of properties) {
    const value = rank(property);
    if (value > bestRank) {
      best = property.id;
      bestRank = value;
      tied = false;
    } else if (value && value === bestRank) tied = true;
  }
  return tied ? "" : best;
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
  // Like the search queries: Google leaves out quiet days, so only the end moves.
  const reported = seoReportedPeriod(search);
  return impressions === null || clicks === null || !reported || !search.length
    ? null
    : {
        impressions,
        clicks,
        period: { from: search[0].from, to: reported.to },
      };
}

/**
 * Recorded page changes as chart markers, each on its day in the metric's time
 * zone, so a change lands on the same day as the measurements around it.
 */
export function seoChangeMarkers(
  timeline: ProjectSeoWorkspace["timeline"],
  timeZone: string,
) {
  const isoDay = { year: "numeric", month: "2-digit", day: "2-digit" } as const;
  let day: Intl.DateTimeFormat;
  try {
    day = new Intl.DateTimeFormat("en-CA", { ...isoDay, timeZone });
  } catch {
    // A zone the browser does not know: UTC days, never a dropped marker.
    day = new Intl.DateTimeFormat("en-CA", { ...isoDay, timeZone: "UTC" });
  }
  return timeline
    .filter((item) => item.kind === "page_change")
    .map((item) => ({
      date: day.format(new Date(item.at)),
      label: item.title,
    }));
}
