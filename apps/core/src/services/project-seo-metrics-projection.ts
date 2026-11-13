import type { ProjectSeoObservation } from "@sokosumi/database";
import { internalServerError } from "@/helpers/error";
import {
  nativeSeoMetricsSchema,
  type ProjectSeoWorkspace,
  type SeoIndexedPage,
  type SeoWorkspaceQuery,
} from "@/schemas/project-seo.schema";
import type { SearchEvidenceSource } from "./project-seo-search-projection";
import { normalizeSeoUrl } from "./project-seo-store";

/** What the metric rows of one workspace read add up to. Rows come newest first. */
export interface SeoMetricsProjection {
  metrics: ProjectSeoWorkspace["metrics"];
  timeline: ProjectSeoWorkspace["timeline"];
  searchSources: SearchEvidenceSource[];
  indexSources: Array<{ at: Date; pages: SeoIndexedPage[] }>;
  /** Organic key events per landing page from the newest Google Analytics sync in view. */
  landingPages: ProjectSeoWorkspace["landingPages"];
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
  // A verdict belongs to one page, so any sync that inspected a selected page counts.
  if (data.indexedPages)
    out.indexSources.push({ at: row.observedAt, pages: data.indexedPages });
  // Distinct-user totals cannot be sliced or added from an incompatible page group.
  if (
    data.pageUrls.length !== selectedUrls.size ||
    data.pageUrls.some((url) => !selectedUrls.has(normalizeSeoUrl(url)))
  )
    return;
  if (query.channel && data.channel !== query.channel) return;
  // Search Console views one search type at a time: a Discover sync never stands in for web search.
  const searchType =
    data.provider === "search_console" ? (data.searchType ?? "web") : null;
  if (searchType && searchType !== (query.searchType ?? "web")) return;
  if (data.provider === "search_console") out.searchSources.push({ row, data });
  out.timeline.push({
    id: `metrics:${row.id}`,
    kind: "metrics",
    title: `${data.provider === "ga4" ? "Analytics" : "Search Console"} statistics synced`,
    at: row.createdAt.toISOString(),
    pageIds: row.pageIds,
    observationId: row.id,
    taskId: null,
    status: data.coverage,
    detail: `${data.from} to ${data.to}. ${data.channel}${searchType && searchType !== "web" ? ` ${searchType}` : ""}. ${data.notes.join(" ")}`,
  });
  const group = JSON.stringify([
    data.provider,
    data.propertyId,
    data.from,
    data.to,
    data.channel,
    searchType,
  ]);
  // Rows come newest first, so the first landing read is the newest one.
  if (data.landingPages && !out.landingPages)
    out.landingPages = {
      ...data.landingPages,
      observationId: row.id,
      propertyId: data.propertyId,
      from: data.from,
      to: data.to,
      observedAt: row.observedAt.toISOString(),
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
      observedAt: row.observedAt.toISOString(),
      coverage: data.coverage,
      notes: data.notes,
      ...(searchType ? { searchType } : {}),
    });
}
