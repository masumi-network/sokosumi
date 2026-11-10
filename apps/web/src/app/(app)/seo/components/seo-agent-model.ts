import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import {
  measuresOutsideToolRanges,
  seoOverviewModel,
} from "./seo-overview-model";
import { normalizeQuery, searchConsoleIndex } from "./seo-search-model";
import { latestSeoMeasurements } from "./seo-statistics-model";

/** Saved Search Console data older than this is refreshed once when the Audit opens. */
export const SEO_SEARCH_STALE_MS = 24 * 60 * 60 * 1000;
/** A sync whose query read failed keeps its totals; wait this long before trying the rows again. */
export const SEO_QUERY_RETRY_MS = 60 * 60 * 1000;
export const SEO_AGENT_ACTION_LIMIT = 3;

type Action = ProjectSeoWorkspace["actions"][number];
export type SeoAgentStep =
  | { kind: "action"; action: Action }
  | {
      kind: "measure";
      name: string;
      value: string;
      tools: string[];
      pageUrl: string;
    }
  | { kind: "keyword"; keyword: string }
  | { kind: "pages" }
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
  // Observations come newest first. Rankings and links reads carry no rule rows,
  // so the last check is the newest observation that asked for rule checks.
  const lastCheck =
    workspace.observations.find(
      ({ coverage }) =>
        coverage.checked + coverage.skipped + coverage.failed > 0 ||
        (coverage.modules?.failed ?? 0) > 0,
    ) ?? null;
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
  // SEO work from free saved data comes before account upkeep.
  // A cut list cannot prove Google left a keyword out.
  const listed =
    workspace.searchQueries && !workspace.searchQueries.truncated
      ? searchConsoleIndex(workspace.searchQueries.rows)
      : null;
  const unseen = listed
    ? workspace.keywords.find(
        (row) => row.saved && !listed.has(normalizeQuery(row.keyword)),
      )
    : undefined;
  if (unseen) steps.push({ kind: "keyword", keyword: unseen.keyword });
  // A value outside the tools' ranges is a suggestion, not an error: it follows the search work.
  const suggestions = measuresOutsideToolRanges(overview.diagnostics);
  for (const { name, value, tools, pageUrl } of suggestions.slice(
    0,
    SEO_AGENT_ACTION_LIMIT,
  ))
    steps.push({ kind: "measure", name, value, tools, pageUrl });
  if (workspace.availableActions.canEdit && workspace.pages.length === 1)
    steps.push({ kind: "pages" });
  if (refresh && (staleSearch || !workspace.searchQueries))
    steps.push({
      kind: "refresh",
      reason: staleSearch ? "stale" : "no_queries",
    });
  // One Google step: until Search Console is connected, its step also offers Google Analytics.
  const needsSearch = canSync && !searchSaved;
  if (needsSearch) steps.push({ kind: "connect", provider: "search_console" });
  const paidSearch = workspace.availableActions.canUsePaidSearchData === true;
  const competitors = workspace.competitors.filter(
    (row) => row.role === "competitor",
  );
  // Without paid data the only step is adding known competitors; once one is saved, it is done.
  if (
    paidSearch
      ? !competitors.some((row) => row.observationId)
      : !competitors.length
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
    // The last-check line counts only what that check found.
    suggestions: lastCheck
      ? suggestions.filter(
          (suggestion) => suggestion.observationId === lastCheck.id,
        ).length
      : 0,
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
