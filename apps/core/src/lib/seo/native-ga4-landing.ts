import {
  SEO_AI_SOURCE_ROW_LIMIT,
  type SeoLandingPages,
} from "@/schemas/project-seo-traffic.schema";
import {
  seoLandingEventSchema,
  seoLandingEvents,
} from "@/schemas/seo-landing-outcomes.schema";
import {
  GA4_CHANNEL_GROUPS,
  ga4ChannelGroupFilter,
  ga4ReportSchema,
  type NativeStatisticsQuery,
} from "./native-statistics";

const LANDING_DIMENSION = "landingPagePlusQueryString";
/** Inside the AI Assistant channel, the session source names the assistant (chatgpt.com, perplexity.ai and others). */
const SOURCE_DIMENSION = "sessionSource";
const LANDING_METRICS = ["sessions", "keyEvents"] as const;
const ORGANIC_LANDING_METRICS = [
  ...LANDING_METRICS,
  "userEngagementDuration",
  "screenPageViews",
] as const;
const HOST_DIMENSION = "hostName";
/** Two rows suffice to disprove a single-host property for the selected period. */
const HOST_ROW_LIMIT = 2;

/** Read all property hosts, without page/channel filters that could hide a second host. */
export function ga4LandingHostArguments(
  query: NativeStatisticsQuery,
): Record<string, unknown> {
  return {
    property: query.propertyId,
    dateRanges: [{ startDate: query.from, endDate: query.to }],
    dimensions: [{ name: HOST_DIMENSION }],
    metrics: [{ name: "sessions" }],
    limit: HOST_ROW_LIMIT,
    returnPropertyQuota: true,
  };
}

/**
 * A path alone cannot prove a landing host. A complete, unsampled property read must name only the selected host.
 * Filtering hostName on the landing report instead would filter events after landing and change key-event attribution.
 */
export function assertGa4LandingHost(
  query: NativeStatisticsQuery,
  input: unknown,
): void {
  const report = ga4ReportSchema.parse(input);
  const hosts = new Set(query.pageUrls.map((url) => new URL(url).hostname));
  if (
    hosts.size !== 1 ||
    report.rowCount !== 1 ||
    report.rows.length !== 1 ||
    report.dimensionHeaders.length !== 1 ||
    report.dimensionHeaders[0]?.name !== HOST_DIMENSION ||
    report.metricHeaders.length !== 1 ||
    report.metricHeaders[0]?.name !== "sessions" ||
    report.rows[0]?.dimensionValues.length !== 1 ||
    report.rows[0]?.metricValues.length !== 1 ||
    !hosts.has(report.rows[0]?.dimensionValues[0]?.value ?? "") ||
    report.metadata?.subjectToThresholding ||
    report.metadata?.dataLossFromOtherRow ||
    report.metadata?.samplingMetadatas?.length
  ) {
    throw new Error("Analytics landing host scope is not determined");
  }
}

/** GA4 names a landing page by its path and query string, without the host. */
function landingPath(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * The pages a landing read can tell apart. GA4's landing dimension carries no host, so
 * "https://example.com/" and "https://blog.example.com/" are one row there. Those pages
 * are left out, never given one page's numbers; the sync names them with a note.
 */
export function ga4LandingPlan(query: NativeStatisticsQuery) {
  const urlsByPath = new Map<string, Set<string>>();
  for (const url of query.pageUrls) {
    const urls = urlsByPath.get(landingPath(url)) ?? new Set<string>();
    urls.add(url);
    urlsByPath.set(landingPath(url), urls);
  }
  const shared = (url: string) =>
    (urlsByPath.get(landingPath(url))?.size ?? 0) > 1;
  const skippedUrls = query.pageUrls.filter(shared);
  return {
    query: {
      ...query,
      pageUrls: query.pageUrls.filter((url) => !shared(url)),
    },
    skippedUrls,
  };
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
  return {
    property: query.propertyId,
    dateRanges: [{ startDate: query.from, endDate: query.to }],
    dimensions: landingDimensions(query).map((name) => ({ name })),
    metrics: (landingChannel(query) === "organic"
      ? ORGANIC_LANDING_METRICS
      : LANDING_METRICS
    ).map((name) => ({ name })),
    dimensionFilter: {
      andGroup: { expressions: landingFilters(paths, landingChannel(query)) },
    },
    limit:
      landingChannel(query) === "ai_assistant"
        ? SEO_AI_SOURCE_ROW_LIMIT
        : paths.length,
    returnPropertyQuota: true,
  };
}

function landingFilters(
  paths: string[],
  channel: ReturnType<typeof landingChannel>,
) {
  return [
    {
      filter: {
        fieldName: LANDING_DIMENSION,
        inListFilter: { values: paths, caseSensitive: true },
      },
    },
    ga4ChannelGroupFilter(GA4_CHANNEL_GROUPS[channel]),
  ];
}

const OUTCOME_DIMENSION = "eventName";
const OUTCOME_METRIC = "eventCount";
/** Count event occurrences in sessions that started on an exact selected organic landing URL. */
export function ga4LandingOutcomeArguments(query: NativeStatisticsQuery) {
  const paths = [...new Set(query.pageUrls.map(landingPath))];
  return {
    property: query.propertyId,
    dateRanges: [{ startDate: query.from, endDate: query.to }],
    dimensions: [{ name: LANDING_DIMENSION }, { name: OUTCOME_DIMENSION }],
    metrics: [{ name: OUTCOME_METRIC }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          ...landingFilters(paths, "organic"),
          {
            filter: {
              fieldName: OUTCOME_DIMENSION,
              inListFilter: {
                values: [...seoLandingEvents],
                caseSensitive: true,
              },
            },
          },
        ],
      },
    },
    limit: paths.length * seoLandingEvents.length,
    returnPropertyQuota: true,
  };
}

export function normalizeGa4LandingOutcomes(
  query: NativeStatisticsQuery,
  raw: unknown,
) {
  const report = ga4ReportSchema.parse(raw);
  if (
    report.dimensionHeaders.map((h) => h.name).join() !==
      [LANDING_DIMENSION, OUTCOME_DIMENSION].join() ||
    report.metricHeaders.length !== 1 ||
    report.metricHeaders[0]?.name !== OUTCOME_METRIC ||
    report.rowCount !== report.rows.length ||
    report.metadata?.subjectToThresholding ||
    report.metadata?.samplingMetadatas?.length ||
    report.metadata?.dataLossFromOtherRow
  )
    throw new Error(
      "Analytics did not return a complete named landing event report",
    );
  const urls = new Map(query.pageUrls.map((url) => [landingPath(url), url]));
  const seen = new Set<string>();
  const rows = report.rows.map((row) => {
    const [path, eventValue] = row.dimensionValues;
    const pageUrl = urls.get(path?.value ?? "");
    const event = seoLandingEventSchema.parse(eventValue?.value);
    const count = row.metricValues[0]?.value;
    const key = JSON.stringify([pageUrl, event]);
    if (
      row.dimensionValues.length !== 2 ||
      row.metricValues.length !== 1 ||
      !pageUrl ||
      count === undefined ||
      !Number.isSafeInteger(count) ||
      seen.has(key)
    )
      throw new Error("Analytics returned an invalid named landing event row");
    seen.add(key);
    return { pageUrl, event, count };
  });
  const zone = report.metadata?.timeZone;
  // GA4 may omit its property timezone. Counts remain descriptive when the calendar cannot be established.
  const timeZone = zone && zone.length <= 100 ? zone : null;
  return { rows, timeZone };
}

/**
 * One row per selected page GA4 reported. A page without a row has no measurement, not zero.
 * An AI Assistant read keeps each assistant's row and adds them up per page; a session has one source.
 */
export function normalizeGa4LandingPages(
  query: NativeStatisticsQuery,
  input: unknown,
  skippedUrls: string[] = [],
): SeoLandingPages {
  const report = ga4ReportSchema.parse(input);
  if (
    report.metadata?.subjectToThresholding ||
    report.metadata?.dataLossFromOtherRow ||
    report.metadata?.samplingMetadatas?.length ||
    (landingChannel(query) === "organic" &&
      (report.rowCount ?? report.rows.length) > report.rows.length)
  )
    throw new Error("Landing page totals are incomplete");
  const dimensions = landingDimensions(query);
  const names = report.metricHeaders.map((h) => h.name).join();
  // A legacy response can still supply sessions and key events, without a reading-depth comparison.
  const hasEngagement =
    landingChannel(query) === "organic" &&
    names === ORGANIC_LANDING_METRICS.join();
  if (
    report.dimensionHeaders.map((header) => header.name).join() !==
      dimensions.join() ||
    (!hasEngagement && names !== LANDING_METRICS.join())
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
      row.metricValues.length !== report.metricHeaders.length ||
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
      ...(hasEngagement && {
        engagementSeconds: row.metricValues[2].value,
        views: row.metricValues[3].value,
      }),
    };
  });
  const skipped = skippedUrls.length ? { skippedUrls } : {};
  if (landingChannel(query) === "organic") {
    // The timezone comes from the very same read as the numerators and session counts.
    const zone = report.metadata?.timeZone;
    const complete =
      hasEngagement &&
      report.rowCount === sources.length &&
      zone &&
      zone.length <= 100;
    return {
      channel: "organic",
      rows: sources.map(({ source: _source, ...row }) => row),
      ...skipped,
      ...(complete && { timeZone: zone }),
    };
  }
  const totals = new Map<string, { sessions: number; keyEvents: number }>();
  for (const row of sources) {
    const total = totals.get(row.pageUrl) ?? { sessions: 0, keyEvents: 0 };
    total.sessions += row.sessions;
    total.keyEvents += row.keyEvents;
    totals.set(row.pageUrl, total);
  }
  const rows = [...totals].map(([pageUrl, total]) => ({ pageUrl, ...total }));
  // A left-out page shows "not read", never the "no sessions" of a page without a row.

  return {
    channel: "ai_assistant",
    rows,
    ...skipped,
    sources: sources
      .filter((row) => row.source)
      .sort((a, b) => b.sessions - a.sessions),
    // Rows past the limit are missing, so page sums are a floor.
    truncated: (report.rowCount ?? report.rows.length) > report.rows.length,
  };
}
