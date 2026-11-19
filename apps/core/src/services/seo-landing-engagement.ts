import { previousSeoPeriod } from "@/lib/seo/native-statistics";
import type { SeoWorkspaceQuery } from "@/schemas/project-seo.schema";
import type { NativeSeoMetrics } from "@/schemas/project-seo-native-metrics.schema";

/** The projection supplies only snapshots that match the viewer, page selection and traffic view. */
export interface LandingSource {
  id: string;
  ownerId: string;
  data: NativeSeoMetrics;
}

interface Counts {
  sessions: number;
  engagementSeconds: number;
  views: number;
}

function completeWindow(source: LandingSource) {
  const { data } = source;
  const landing = data.landingPages;
  if (
    data.provider !== "ga4" ||
    data.coverage !== "complete" ||
    landing?.channel !== "organic" ||
    !landing.verifiedHost ||
    landing.truncated ||
    landing.skippedUrls?.length ||
    !landing.timeZone ||
    landing.timeZone !== data.timeZone
  )
    return;

  // A current local day can change after collection. A cached selection retains the original read time.
  const readAt = new Date(data.collectedAt ?? data.observedAt);
  try {
    const localDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: data.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(readAt);
    if (data.to >= localDay) return;
  } catch {
    return;
  }
  const selected = new Set(data.pageUrls);
  if (
    selected.size !== data.pageUrls.length ||
    landing.rows.length !== selected.size
  )
    return;
  const rows = new Map<string, Counts>();
  let sessions = 0;
  for (const {
    pageUrl,
    sessions: count,
    engagementSeconds,
    views,
  } of landing.rows) {
    if (
      !selected.has(pageUrl) ||
      rows.has(pageUrl) ||
      new URL(pageUrl).hostname !== landing.verifiedHost ||
      !Number.isSafeInteger(count) ||
      count <= 0 ||
      engagementSeconds === undefined ||
      !Number.isSafeInteger(engagementSeconds) ||
      views === undefined ||
      !Number.isSafeInteger(views)
    )
      return;
    sessions += count;
    rows.set(pageUrl, { sessions: count, engagementSeconds, views });
  }
  if (!Number.isSafeInteger(sessions) || sessions <= 0) return;
  return {
    rows,
    period: {
      from: data.from,
      to: data.to,
      sessions,
      observationId: source.id,
    },
  };
}

type Window = NonNullable<ReturnType<typeof completeWindow>>;

function rateChange(
  before: Window,
  after: Window,
  metric: "engagementSeconds" | "views",
) {
  let oldValue = 0,
    newValue = 0,
    withinPageChange = 0,
    mixChange = 0;
  for (const [url, old] of before.rows) {
    const current = after.rows.get(url)!;
    const oldShare = old.sessions / before.period.sessions;
    const newShare = current.sessions / after.period.sessions;
    const oldRate = old[metric] / old.sessions;
    const newRate = current[metric] / current.sessions;
    oldValue += old[metric];
    newValue += current[metric];
    // Symmetric decomposition: averaging shares and rates assigns the interaction equally.
    withinPageChange += ((oldShare + newShare) / 2) * (newRate - oldRate);
    mixChange += ((newRate + oldRate) / 2) * (newShare - oldShare);
  }
  return {
    before: oldValue / before.period.sessions,
    after: newValue / after.period.sessions,
    withinPageChange,
    mixChange,
  };
}

export function landingEngagementChange(
  sources: LandingSource[],
  query: SeoWorkspaceQuery,
) {
  // Rows arrive newest selected first. An incomplete new sync must not resurrect superseded coverage.
  const current = sources.find(
    ({ data }) =>
      (!query.from || data.from === query.from) &&
      (!query.to || data.to === query.to),
  );
  if (!current) return;
  const { data } = current;
  const after = completeWindow(current);
  if (!after) return;
  const priorPeriod = previousSeoPeriod(data.from, data.to);
  const evidence = data.landingEngagementEvidence;
  if (!evidence || evidence.previousUnavailable) return;
  const paired = evidence.previous;
  let prior: LandingSource | undefined;
  if (paired) {
    if (paired.from !== priorPeriod.from || paired.to !== priorPeriod.to)
      return;
    prior = { ...current, data: { ...data, ...paired } };
  } else {
    prior = sources.find(
      (s) =>
        s.ownerId === current.ownerId &&
        s.data.propertyId === data.propertyId &&
        s.data.channel === data.channel &&
        s.data.from === priorPeriod.from &&
        s.data.to === priorPeriod.to &&
        s.data.landingEngagementEvidence?.connectionVersion ===
          evidence.connectionVersion,
    );
  }
  if (!prior || prior.data.timeZone !== data.timeZone) return;
  const before = completeWindow(prior);
  if (
    !before ||
    before.rows.size !== after.rows.size ||
    [...before.rows.keys()].some((url) => !after.rows.has(url))
  )
    return;
  return {
    propertyId: data.propertyId,
    timeZone: data.timeZone,
    pageCount: before.rows.size,
    before: before.period,
    after: after.period,
    engagementSecondsPerSession: rateChange(before, after, "engagementSeconds"),
    viewsPerSession: rateChange(before, after, "views"),
  };
}
