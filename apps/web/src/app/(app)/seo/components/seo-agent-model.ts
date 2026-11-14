import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { seoOpenFixes, seoOverviewModel } from "./seo-overview-model";
import { seoStrategyRows } from "./seo-places-model";
import { latestSeoMeasurements } from "./seo-statistics-model";
import { lastRuleCheck } from "./seo-summary-model";

/** Saved Search Console data older than this is refreshed once when the Audit opens. */
export const SEO_SEARCH_STALE_MS = 24 * 60 * 60 * 1000;
/** A sync whose query read failed keeps its totals; wait this long before trying the rows again. */
export const SEO_QUERY_RETRY_MS = 60 * 60 * 1000;
export const SEO_AGENT_ACTION_LIMIT = 3;

type Action = ProjectSeoWorkspace["actions"][number];
export type SeoAgentStep =
  | { kind: "action"; action: Action }
  | { kind: "strategy"; count: number; places: boolean }
  | { kind: "refresh"; reason: "stale" | "no_queries" }
  | { kind: "connect"; provider: "ga4" | "search_console" }
  | { kind: "competitors"; available: boolean };

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
  const lastCheck = lastRuleCheck(workspace);
  const fixes = seoOpenFixes(overview);
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
  // The audit's strategy actions are one step that opens their list. It has no end,
  // so it comes after the work that has one.
  // One row per place: the list it opens has that many rows.
  const strategyRows = seoStrategyRows(workspace.strategy);
  if (strategyRows.count) steps.push({ kind: "strategy", ...strategyRows });
  if (refresh && (staleSearch || !workspace.searchQueries))
    steps.push({
      kind: "refresh",
      reason: staleSearch ? "stale" : "no_queries",
    });
  // One Google step at a time: Search Console first, Google Analytics after its statistics are saved.
  const needsSearch = canSync && !searchSaved;
  if (needsSearch) steps.push({ kind: "connect", provider: "search_console" });
  const paidSearch = workspace.availableActions.canUsePaidSearchData === true;
  const competitors = workspace.competitors.filter(
    (row) => row.role === "competitor",
  );
  // Without paid data the only step is adding known competitors; once one is saved, it is done.
  // With checks off too, a saved competitor can show nothing, so the step would lead nowhere.
  if (
    paidSearch
      ? !competitors.some((row) => row.observationId)
      : workspace.availableActions.canRequestAnalysis && !competitors.length
  )
    steps.push({ kind: "competitors", available: paidSearch });
  if (canSync && !needsSearch && !analytics.length)
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
    emptyState: overview.emptyState,
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
