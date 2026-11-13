import {
  SEO_AI_SOURCE_ROW_LIMIT,
  type SeoLandingPages,
} from "@/schemas/project-seo-traffic.schema";
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
/** Inside the AI Assistant channel, the session source names the assistant (chatgpt.com, perplexity.ai and others). */
const SOURCE_DIMENSION = "sessionSource";
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

function landingDimensions(query: NativeStatisticsQuery) {
  return landingChannel(query) === "ai_assistant"
    ? [LANDING_DIMENSION, SOURCE_DIMENSION]
    : [LANDING_DIMENSION];
}

/**
 * Sessions and key events of one channel for sessions that started on a selected page.
 * The filter is on the landing page, so a key event later in the session counts
 * for the page the visitor came in on. A landing URL with extra query
 * parameters (for example a tracking tag) is a different row and is not read.
 * An AI Assistant read also splits each page by session source. The channel is
 * GA4's own grouping: no hand-kept list of assistant referrers is used.
 */
export function ga4LandingPageArguments(
  query: NativeStatisticsQuery,
): Record<string, unknown> {
  const paths = [...new Set(query.pageUrls.map(landingPath))];
  const bySource = landingChannel(query) === "ai_assistant";
  return {
    property: query.propertyId,
    dateRanges: [{ startDate: query.from, endDate: query.to }],
    dimensions: landingDimensions(query).map((name) => ({ name })),
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
    limit: bySource ? SEO_AI_SOURCE_ROW_LIMIT : paths.length,
    returnPropertyQuota: true,
  };
}

/**
 * One row per selected page GA4 reported. A page without a row has no measurement, not zero.
 * An AI Assistant read keeps each assistant's row and adds them up per page; a session has one source.
 */
export function normalizeGa4LandingPages(
  query: NativeStatisticsQuery,
  input: unknown,
): SeoLandingPages {
  const report = ga4ReportSchema.parse(input);
  const dimensions = landingDimensions(query);
  if (
    report.dimensionHeaders.map((header) => header.name).join() !==
      dimensions.join() ||
    report.metricHeaders.map((header) => header.name).join() !==
      LANDING_METRICS.join()
  )
    throw new Error("Analytics returned a different landing page grouping");
  const byPath = new Map<string, string>();
  for (const url of query.pageUrls)
    if (!byPath.has(landingPath(url))) byPath.set(landingPath(url), url);
  const seen = new Set<string>();
  const sources = report.rows.map((row) => {
    const [path = "", source = ""] = row.dimensionValues.map(
      (value) => value.value,
    );
    const pageUrl = byPath.get(path);
    const identity = JSON.stringify([path, source]);
    if (
      row.dimensionValues.length !== dimensions.length ||
      row.metricValues.length !== LANDING_METRICS.length ||
      !pageUrl ||
      seen.has(identity)
    )
      throw new Error(
        "Analytics returned a landing page outside the selection",
      );
    seen.add(identity);
    return {
      pageUrl,
      source,
      sessions: row.metricValues[0].value,
      keyEvents: row.metricValues[1].value,
    };
  });
  const totals = new Map<string, { sessions: number; keyEvents: number }>();
  for (const row of sources) {
    const total = totals.get(row.pageUrl) ?? { sessions: 0, keyEvents: 0 };
    total.sessions += row.sessions;
    total.keyEvents += row.keyEvents;
    totals.set(row.pageUrl, total);
  }
  const rows = [...totals].map(([pageUrl, total]) => ({ pageUrl, ...total }));
  if (landingChannel(query) === "organic") return { channel: "organic", rows };
  return {
    channel: "ai_assistant",
    rows,
    sources: sources
      .filter((row) => row.source)
      .sort((a, b) => b.sessions - a.sessions),
    // Rows past the limit are missing, so page sums are a floor.
    truncated: (report.rowCount ?? report.rows.length) > report.rows.length,
  };
}
