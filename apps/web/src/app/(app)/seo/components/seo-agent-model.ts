import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { seoOverviewModel } from "./seo-overview-model";
import { latestSeoMeasurements } from "./seo-statistics-model";

/** Saved Search Console data older than this is refreshed once when the Audit opens. */
export const SEO_SEARCH_STALE_MS = 24 * 60 * 60 * 1000;
/** A sync whose query read failed keeps its totals; wait this long before trying the rows again. */
export const SEO_QUERY_RETRY_MS = 60 * 60 * 1000;
export const SEO_AGENT_ACTION_LIMIT = 3;

type Action = ProjectSeoWorkspace["actions"][number];
export type SeoAgentStep =
  | { kind: "action"; action: Action }
  | { kind: "refresh"; reason: "stale" | "no_queries" }
  | { kind: "connect"; provider: "ga4" | "search_console" }
  | { kind: "competitors"; available: boolean };

function metricValue(
  metrics: ProjectSeoWorkspace["metrics"],
  key: string,
): number | null {
  return metrics.find((metric) => metric.key === key)?.value ?? null;
}

/**
 * What the SEO agent can say from saved evidence, and the next steps it offers.
 * Every number comes from a stored observation; missing evidence becomes a step.
 */
export function seoAgentBrief(workspace: ProjectSeoWorkspace, now: Date) {
  const overview = seoOverviewModel(workspace);
  const latest = latestSeoMeasurements(workspace.metrics);
  const search = latest.filter((metric) => metric.source === "search_console");
  const analytics = latest.filter((metric) => metric.source === "ga4");
  const searchSaved = search[0] ?? null;
  const lastCheck = workspace.observations[0] ?? null;
  const fixes = overview.recommendedActions.filter(
    (action) => action.kind === "fix",
  );
  const opportunities = overview.recommendedActions.filter(
    (action) => action.kind === "opportunity",
  );
  const openTasks = workspace.actions.filter(
    (action) => action.status === "task_created",
  ).length;
  const searchAge = searchSaved
    ? now.getTime() - new Date(searchSaved.observedAt).getTime()
    : null;
  const staleSearch = searchAge !== null && searchAge > SEO_SEARCH_STALE_MS;
  const canSync = workspace.availableActions.canSyncMetrics;
  const refresh =
    canSync && searchSaved
      ? { propertyId: searchSaved.propertyId, channel: searchSaved.channel }
      : null;
  const steps: SeoAgentStep[] = [...fixes, ...opportunities]
    .slice(0, SEO_AGENT_ACTION_LIMIT)
    .map((action) => ({ kind: "action", action }));
  if (refresh && (staleSearch || !workspace.searchQueries))
    steps.push({
      kind: "refresh",
      reason: staleSearch ? "stale" : "no_queries",
    });
  if (canSync && !searchSaved)
    steps.push({ kind: "connect", provider: "search_console" });
  if (!workspace.competitors.some((row) => row.observationId))
    steps.push({
      kind: "competitors",
      available: workspace.availableActions.canUsePaidSearchData === true,
    });
  if (canSync && !analytics.length)
    steps.push({ kind: "connect", provider: "ga4" });
  return {
    lastCheck: lastCheck
      ? {
          at: lastCheck.observedAt,
          checked: lastCheck.coverage.checked,
          pages: lastCheck.pageIds.length,
        }
      : null,
    issues: overview.issues.length,
    search: searchSaved
      ? {
          from: searchSaved.from,
          to: searchSaved.to,
          observedAt: searchSaved.observedAt,
          clicks: metricValue(search, "clicks"),
          impressions: metricValue(search, "impressions"),
          ctr: metricValue(search, "ctr"),
          position: metricValue(search, "position"),
          queries: workspace.searchQueries?.rows.length ?? null,
          queriesTruncated: workspace.searchQueries?.truncated ?? false,
        }
      : null,
    fixes: fixes.length,
    opportunities: opportunities.length,
    openTasks,
    staleSearch,
    refresh,
    // Upkeep is a free read of the saved property: stale totals or missing query rows.
    autoRefresh:
      refresh !== null &&
      (staleSearch ||
        (!workspace.searchQueries &&
          searchAge !== null &&
          searchAge > SEO_QUERY_RETRY_MS)),
    steps,
  };
}

export type SeoAgentBrief = ReturnType<typeof seoAgentBrief>;
