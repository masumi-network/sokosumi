import type { SeoLandingPages } from "@/schemas/project-seo-traffic.schema";
import {
  GA4_CHANNEL_GROUPS,
  ga4ChannelGroupFilter,
  ga4ReportSchema,
  type NativeStatisticsQuery,
} from "./native-statistics";

/** The landing page read failed. Totals are separate reads, so this note does not mark lost data. */
export const GA4_LANDING_PAGES_UNAVAILABLE_NOTE =
  "Google Analytics key events per landing page were unavailable for this sync. Other measurements are kept.";
const LANDING_DIMENSION = "landingPagePlusQueryString";
const LANDING_METRICS = ["sessions", "keyEvents"] as const;

/** GA4 names a landing page by its path and query string, without the host. */
function landingPath(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

/** Landing rows follow an AI Assistant read; every other read counts organic search. */
function landingChannel(query: NativeStatisticsQuery) {
  return query.channel === "ai_assistant" ? "ai_assistant" : "organic";
}

/**
 * Sessions and key events of one channel for sessions that started on a selected page.
 * The filter is on the landing page, so a key event later in the session counts
 * for the page the visitor came in on. A landing URL with extra query
 * parameters (for example a tracking tag) is a different row and is not read.
 */
export function ga4LandingPageArguments(
  query: NativeStatisticsQuery,
): Record<string, unknown> {
  const paths = [...new Set(query.pageUrls.map(landingPath))];
  return {
    property: query.propertyId,
    dateRanges: [{ startDate: query.from, endDate: query.to }],
    dimensions: [{ name: LANDING_DIMENSION }],
    metrics: LANDING_METRICS.map((name) => ({ name })),
    dimensionFilter: {
      andGroup: {
        expressions: [
          {
            filter: {
              fieldName: LANDING_DIMENSION,
              inListFilter: { values: paths, caseSensitive: true },
            },
          },
          ga4ChannelGroupFilter(GA4_CHANNEL_GROUPS[landingChannel(query)]),
        ],
      },
    },
    limit: paths.length,
    returnPropertyQuota: true,
  };
}

/** One row per selected page GA4 reported. A page without a row has no measurement, not zero. */
export function normalizeGa4LandingPages(
  query: NativeStatisticsQuery,
  input: unknown,
): SeoLandingPages {
  const report = ga4ReportSchema.parse(input);
  if (
    report.dimensionHeaders.map((header) => header.name).join() !==
      LANDING_DIMENSION ||
    report.metricHeaders.map((header) => header.name).join() !==
      LANDING_METRICS.join()
  )
    throw new Error("Analytics returned a different landing page grouping");
  const byPath = new Map<string, string>();
  for (const url of query.pageUrls)
    if (!byPath.has(landingPath(url))) byPath.set(landingPath(url), url);
  const seen = new Set<string>();
  const rows = report.rows.map((row) => {
    const path = row.dimensionValues[0]?.value ?? "";
    const pageUrl = byPath.get(path);
    if (
      row.dimensionValues.length !== 1 ||
      row.metricValues.length !== LANDING_METRICS.length ||
      !pageUrl ||
      seen.has(path)
    )
      throw new Error(
        "Analytics returned a landing page outside the selection",
      );
    seen.add(path);
    return {
      pageUrl,
      sessions: row.metricValues[0].value,
      keyEvents: row.metricValues[1].value,
    };
  });
  return { channel: landingChannel(query), rows };
}
