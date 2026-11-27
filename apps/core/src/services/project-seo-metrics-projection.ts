import type { ProjectSeoObservation } from "@sokosumi/database";
import { SEO_STATISTICS_ANALYTICS_LANDING_PAGES_UNAVAILABLE_NOTE } from "@sokosumi/utils";
import { internalServerError } from "@/helpers/error";
import { previousSeoPeriod } from "@/lib/seo/native-statistics";
import {
  type ProjectSeoWorkspace,
  type SeoIndexedPage,
  type SeoWorkspaceQuery,
} from "@/schemas/project-seo.schema";
import { nativeSeoMetricsSchema } from "@/schemas/project-seo-native-metrics.schema";
import type { SearchEvidenceSource } from "./project-seo-search-projection";
import { normalizeSeoUrl } from "./project-seo-store";
import type { LandingSource } from "./seo-landing-engagement";

/** What the metric rows of one workspace read add up to. Rows come newest first. */
export interface SeoMetricsProjection {
  metrics: ProjectSeoWorkspace["metrics"];
  collections: Map<string, ProjectSeoWorkspace["timeline"][number]>;
  searchSources: SearchEvidenceSource[];
  landingSources: LandingSource[];
  indexSources: Array<{ at: Date; pages: SeoIndexedPage[] }>;
  /** The newest Google Analytics landing read in view of each channel: organic, and AI assistants. */
  landing: Pick<ProjectSeoWorkspace, "landingPages" | "aiAssistantPages">;
  /** The newest sync of each property, period and view wins; older ones only add timeline rows. */
  seenGroups: Set<string>;
}

/** Adds one stored native metrics snapshot to the projection, or skips it where it does not fit the selection. */
export function projectSeoMetricsRow(
  row: ProjectSeoObservation,
  query: SeoWorkspaceQuery,
  selectedUrls: Set<string>,
  out: SeoMetricsProjection,
): void {
  const parsed = nativeSeoMetricsSchema.safeParse(row.payload);
  if (!row.ownerId)
    throw internalServerError("Stored analytics evidence is not readable");
  // A newer build may store fields this build does not know. That sync is
  // skipped with its timeline entry and verdicts, so a rollback shows the
  // older syncs instead of failing the page. A new enum value still fails.
  if (
    !parsed.success &&
    parsed.error.issues.every((issue) => issue.code === "unrecognized_keys")
  )
    return;
  if (!parsed.success)
    throw internalServerError("Stored analytics evidence is not readable");
  const data = parsed.data;
  // A sync stores the keywords past the first 25 apart. Every reader gets one series.
  if (data.keywordSeries && data.keywordSeriesMore)
    data.keywordSeries.keywords.push(...data.keywordSeriesMore);
  data.keywordSeriesMore = undefined;
  // Older GA4 syncs shortened the previous window to the last traffic day while retaining the full current total.
  if (data.provider === "ga4") {
    const previous = previousSeoPeriod(data.from, data.to);
    for (const metric of data.metrics)
      if (
        metric.previous &&
        (metric.previous.from !== previous.from ||
          metric.previous.to !== previous.to)
      )
        metric.previous = undefined;
  }
  // Older syncs mapped a path to a URL without proving the host. Keep their page metrics, but withhold landing totals.
  if (
    data.landingPages &&
    (!data.landingPages.verifiedHost ||
      data.pageUrls.some(
        (url) => new URL(url).hostname !== data.landingPages?.verifiedHost,
      ))
  ) {
    data.landingPages = undefined;
    if (
      !data.notes.includes(
        SEO_STATISTICS_ANALYTICS_LANDING_PAGES_UNAVAILABLE_NOTE,
      )
    )
      data.notes.push(SEO_STATISTICS_ANALYTICS_LANDING_PAGES_UNAVAILABLE_NOTE);
  }
  // A verdict belongs to one page, so any sync that inspected a selected page counts.
  const collectedAt = data.collectedAt ?? row.observedAt.toISOString();
  for (const page of data.indexedPages ?? [])
    out.indexSources.push({
      at: new Date(
        data.inspectionCache?.checkedAt[page.pageUrl] ?? collectedAt,
      ),
      pages: [page],
    });
  // Distinct-user totals cannot be sliced or added from an incompatible page group.
  if (
    data.pageUrls.length !== selectedUrls.size ||
    data.pageUrls.some((url) => !selectedUrls.has(normalizeSeoUrl(url)))
  )
    return;
  if (query.channel && data.channel !== query.channel) return;
  if (data.provider === "ga4" && data.channel !== "ai_assistant")
    out.landingSources.push({ id: row.id, ownerId: row.ownerId, data });
  // Search Console views one search type at a time: a Discover sync never stands in for web search.
  const searchType =
    data.provider === "search_console" ? (data.searchType ?? "web") : null;
  if (searchType && searchType !== (query.searchType ?? "web")) return;
  if (data.provider === "search_console") out.searchSources.push({ row, data });
  const collection = data.collectionFingerprint
    ? JSON.stringify([row.ownerId, data.collectionFingerprint, collectedAt])
    : row.id;
  const reactivated = row.observedAt.getTime() !== Date.parse(collectedAt);
  // A replay represents its original collection until the original row itself is encountered.
  if (!reactivated || !out.collections.has(collection)) {
    out.collections.set(collection, {
      id: `metrics:${row.id}`,
      kind: "metrics",
      title: `${data.provider === "ga4" ? "Analytics" : "Search Console"} statistics synced`,
      at: data.collectionFingerprint
        ? collectedAt
        : row.createdAt.toISOString(),
      pageIds: row.pageIds,
      observationId: row.id,
      taskId: null,
      status: data.coverage,
      detail: `${data.from} to ${data.to}. ${data.channel}${searchType && searchType !== "web" ? ` ${searchType}` : ""}. ${data.notes.join(" ")}`,
    });
  }
  const group = JSON.stringify([
    data.provider,
    data.propertyId,
    data.from,
    data.to,
    data.channel,
    searchType,
  ]);
  // Rows come newest first, so the first landing read of a channel is its newest one. A cached read that is used
  // again comes first with its old collection time: it is the read in view, as for the metrics and the engagement
  // change below, which take the first row too. A newer read of the other channel does not replace it: organic key
  // events and AI assistant visits are separate counts.
  const landingKey =
    data.landingPages?.channel === "ai_assistant"
      ? "aiAssistantPages"
      : "landingPages";
  if (data.landingPages && !out.landing[landingKey])
    out.landing[landingKey] = {
      ...data.landingPages,
      // The pages the read asked for: one of them without a row had no session, which is a measured zero.
      pageUrls: data.pageUrls,
      observationId: row.id,
      propertyId: data.propertyId,
      from: data.from,
      to: data.to,
      observedAt: collectedAt,
    };
  if (out.seenGroups.has(group)) return;
  out.seenGroups.add(group);
  for (const metric of data.metrics)
    out.metrics.push({
      id: `${row.id}:${metric.key}`,
      ...metric,
      source: data.provider,
      propertyId: data.propertyId,
      from: data.from,
      to: data.to,
      timeZone: data.timeZone,
      channel: data.channel,
      observedAt: collectedAt,
      ...(reactivated && {
        selectedAt: row.observedAt.toISOString(),
      }),
      coverage: data.coverage,
      notes: data.notes,
      ...(searchType ? { searchType } : {}),
    });
}
