import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import {
  SEO_ISSUE_SEVERITY_NAMES,
  type SeoIssueSeverity,
  seoOpenFixes,
  seoOverviewModel,
} from "./seo-overview-model";
import { seoStrategyRows } from "./seo-places-model";
import { isSeoRuleCheck } from "./seo-runs-model";
import { latestSeoMeasurements } from "./seo-statistics-model";
import { seoIssueScope } from "./seo-summary-model";

/** Saved Search Console data older than this is refreshed once when the Audit opens. */
export const SEO_SEARCH_STALE_MS = 24 * 60 * 60 * 1000;
/** A sync whose query read failed keeps its totals; wait this long before trying the rows again. */
export const SEO_QUERY_RETRY_MS = 60 * 60 * 1000;

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
  const scope = seoIssueScope(workspace, overview.issues);
  const lastCheck = scope.check;
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
  // Every fix is a step: the Agent tab folds the ones after the first.
  const steps: SeoAgentStep[] = overview.recommendedActions.map((action) => ({
    kind: "action",
    action,
  }));
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
          id: lastCheck.id,
          at: lastCheck.observedAt,
          checked: lastCheck.coverage.checked,
          pages: lastCheck.pageIds.length,
        }
      : null,
    issues: scope.total ?? (lastCheck ? 0 : scope.current.length),
    earlierIssues: scope.earlier.length,
    ruleCheckOutsideSelection:
      !lastCheck &&
      Boolean(workspace.runs?.some((row) => isSeoRuleCheck(row.kind))),

    checkClear: scope.total === 0,
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

/**
 * The counts the Agent tab leads with: the fix rows of its list, split by the impact of the worst issue each fixes,
 * and the suggestion rows apart, since a suggestion fixes no error. A split that leaves a fix out would not add up
 * to the count, so the count then stands alone.
 */
export function seoActionHeadline(
  steps: SeoAgentStep[],
  severity: (action: Action) => SeoIssueSeverity | null,
) {
  const actions = steps.flatMap((step) =>
    step.kind === "action" ? [step.action] : [],
  );
  const fixes = actions.filter((action) => action.kind !== "opportunity");
  const parts = SEO_ISSUE_SEVERITY_NAMES.map((name) => ({
    severity: name,
    count: fixes.filter((action) => severity(action) === name).length,
  })).filter((part) => part.count > 0);
  const named = parts.reduce((sum, part) => sum + part.count, 0);
  return {
    fixes: fixes.length,
    parts: named === fixes.length ? parts : [],
    suggestions: actions.length - fixes.length,
  };
}

/**
 * Where a fix from an earlier check stands in the page checks after it: still failing in the check that found it last,
 * or not tested again since the check that proposed it. Null for a fix of the newest check, and for one a later check
 * fixed: a proposal it fixed is no longer listed.
 */
export function seoFixCheckState(
  action: Action,
  workspace: Pick<ProjectSeoWorkspace, "observations">,
): { state: "failing" | "notTested"; day: Date } | null {
  const newest = workspace.observations.find((row) => isSeoRuleCheck(row.kind));
  const own = workspace.observations.find(
    (row) => row.id === action.observationId,
  );
  if (action.kind !== "fix" || !newest || !own || own.id === newest.id)
    return null;
  if (action.lastCheckResult === "failing" && action.lastCheckAt)
    return { state: "failing", day: action.lastCheckAt };
  return action.lastCheckResult
    ? null
    : { state: "notTested", day: own.observedAt };
}
