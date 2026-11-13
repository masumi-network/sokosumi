import type {
  ProjectSeoMetric,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { seoStatisticsLostData } from "@sokosumi/utils";
import { seoWindowDays } from "./seo-performance-model";

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

/** True when the text names this host as a whole: "staging.example.com" and "myexample.com" do not name example.com. */
function namesHost(text: string, host: string) {
  // An empty host is found at every place, and the search below would not end.
  if (!host) return false;
  for (
    let at = text.indexOf(host);
    at !== -1;
    at = text.indexOf(host, at + 1)
  ) {
    const before = text[at - 1] ?? "";
    const after = text.slice(at + host.length, at + host.length + 2);
    if (!/[a-z0-9.-]/.test(before) && !/^(?:[a-z0-9-]|\.[a-z0-9])/.test(after))
      return true;
  }
  return false;
}

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
      return namesHost(
        // "www." counts only where a host starts: "awww.com" keeps its name.
        property.name.toLowerCase().replace(/(^|[^a-z0-9.-])www\./g, "$1"),
        host,
      )
        ? 1
        : 0;
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

/**
 * The quick choices of the date filter, in days. They show on the tabs of checks (Rankings and Actions), so
 * each ends today: a check of today is in it. No "same period last year": a sync reads 90 days and compares
 * them with the 90 days before, so no year-old day is saved.
 */
export const SEO_DATE_PRESET_DAYS = [7, 28, 90] as const;

/** The quick choice a period is, or null for a period the reader typed. */
export function seoDatePreset(
  period: { from: string | null; to: string | null },
  now = new Date(),
) {
  return (
    SEO_DATE_PRESET_DAYS.find((days) => {
      const preset = seoCheckPeriod(days, now);
      return preset.from === period.from && preset.to === period.to;
    }) ?? null
  );
}

/** The last `days` days of checks, today included. A sync's period ends yesterday: see seoStatisticsPeriod. */
export function seoCheckPeriod(days: number, now = new Date()) {
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - days + 1);
  return {
    from: from.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
  };
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

/** The calendar period behind the totals. Quiet trailing days do not shorten a settled window. */
export function seoMeasuredPeriod(metrics: ProjectSeoMetric[]) {
  const first = metrics[0];
  if (!first) return null;
  if (first.source === "ga4") return { from: first.from, to: first.to };
  const before = metrics.find((metric) => metric.previous)?.previous;
  if (before) {
    // Core reads an equal window before the settled current period. Its length also retains quiet days.
    const end = new Date(`${first.from}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + seoWindowDays(before) - 1);
    return { from: first.from, to: end.toISOString().slice(0, 10) };
  }
  // Older reads, or failed comparison reads, have no settled endpoint beyond their last reported day.
  const reported = seoReportedPeriod(metrics);
  return reported ? { from: first.from, to: reported.to } : null;
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
  const reported = seoMeasuredPeriod(sameRead);
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
  const reported = seoMeasuredPeriod(search);
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
