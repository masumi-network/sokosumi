import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import {
  readSeoStatisticsNote,
  SEO_CAPABILITIES,
  SEO_CAPABILITY_GROUPS,
  SEO_CAPABILITY_UNLOCKS,
  type SeoCapability,
  type SeoCapabilityUnlock,
  type SeoStatisticsNoteGap,
} from "@sokosumi/utils";
import { latestSeoMeasurements } from "./seo-statistics-model";

export const SEO_CAPABILITY_FILTERS = ["all", "missing", "partial"] as const;
export type SeoCapabilityFilter = (typeof SEO_CAPABILITY_FILTERS)[number];

/** The items not built yet, in the doc's groups and order; a group with no item in the filter is left out. */
export function seoCapabilityGroups(
  filter: SeoCapabilityFilter,
  catalog: readonly SeoCapability[] = SEO_CAPABILITIES,
) {
  const open = catalog.filter(
    (item) =>
      item.status !== "built" && (filter === "all" || item.status === filter),
  );
  return SEO_CAPABILITY_GROUPS.map((group) => ({
    group,
    items: open.filter((item) => item.group === group),
  })).filter((group) => group.items.length > 0);
}

/** The step that fills a gap, where the reader may take it. */
export type SeoAuditGapFix =
  | "connect_search_console"
  | "connect_ga4"
  | "sync"
  | "run_check";

export type SeoAuditGap = {
  /** A message key under "App.Seo.improve.gaps". */
  message:
    | "noSearchConsole"
    | "noAnalytics"
    | "statisticsUnavailable"
    | SeoStatisticsNoteGap
    | "note"
    | "queriesTruncated"
    | "noCheck"
    | "notChecked"
    | "failed"
    | "modulesNotRequested"
    | "modulesFailed"
    | "paidOff"
    | "historyLimited";
  /** A stored note Core wrote in English, for a note the note catalog does not know. */
  note?: string;
  count?: number;
  /** Module or keyword names, for the reader's list format. */
  names?: string[];
  fix: SeoAuditGapFix | null;
};

/**
 * The values of one gap's message. `list` joins names in the reader's language. A cut note names fewer
 * keywords than it counts, so `more` says how many it left out; `shown` 0 leaves the list out.
 */
export function seoAuditGapValues(
  gap: SeoAuditGap,
  list: (names: string[]) => string,
) {
  const names = gap.names ?? [];
  const count = gap.count ?? 0;
  return {
    note: gap.note ?? "",
    count,
    limit: count,
    names: list(names),
    shown: names.length,
    more: Math.max(0, count - names.length),
  };
}

/**
 * Whether a filter narrows the statistics Core returns: a sync counts only for its exact page group,
 * channel and search type, and Search Console stores "organic" only. A narrowed view can lack a connected
 * source's data. Web search is the default search type, so it does not narrow.
 */
export function seoViewNarrowed(filters: {
  channel?: string | null;
  pageId?: string | null;
  scopeId?: string | null;
  searchType?: string | null;
}) {
  return Boolean(
    filters.channel ||
      filters.pageId ||
      filters.scopeId ||
      (filters.searchType && filters.searchType !== "web"),
  );
}

/** Which Google sources the saved statistics of these pages come from. */
function connectedSources(data: ProjectSeoWorkspace) {
  const latest = latestSeoMeasurements(data.metrics);
  return {
    search_console:
      data.searchQueries !== null ||
      latest.some((metric) => metric.source === "search_console"),
    ga4: latest.some((metric) => metric.source === "ga4"),
  };
}

/**
 * What the data of these pages leaves out, from what the workspace already holds: the Google sources with no
 * sync, the notes of the last sync, the search rows Google cut, the tests of the newest check without a result,
 * the optional checks it did not run, paid data that is off and history that is cut. A fix shows only where the
 * reader may take it.
 */
export function seoAuditGaps(
  data: ProjectSeoWorkspace,
  narrowed = false,
): SeoAuditGap[] {
  const { canSyncMetrics, canRequestAnalysis, canUsePaidSearchData } =
    data.availableActions;
  const sync = canSyncMetrics ? "sync" : null;
  const check = canRequestAnalysis ? "run_check" : null;
  const connected = connectedSources(data);
  const gaps: SeoAuditGap[] = [];
  // A narrowed view says nothing about a source it does not show.
  if (!connected.search_console && !narrowed)
    gaps.push({
      message: "noSearchConsole",
      fix: canSyncMetrics ? "connect_search_console" : null,
    });
  if (!connected.ga4 && !narrowed)
    gaps.push({
      message: "noAnalytics",
      fix: canSyncMetrics ? "connect_ga4" : null,
    });
  // Core says "unavailable" whenever there are no statistics; only a sync that read nothing is this gap.
  const latest = latestSeoMeasurements(data.metrics);
  if (latest.some((metric) => metric.coverage === "unavailable"))
    gaps.push({ message: "statisticsUnavailable", fix: sync });
  const notes = new Set(latest.flatMap((metric) => metric.notes));
  // A routine note comes with every sync, and a flag note repeats a field read below (the cut query rows).
  for (const note of notes) {
    const reading = readSeoStatisticsNote(note);
    if (!reading) gaps.push({ message: "note", note, fix: sync });
    else if (reading.kind === "gap") {
      const { gap: message, count, names } = reading;
      gaps.push({
        message,
        ...(count === undefined ? {} : { count }),
        ...(names ? { names } : {}),
        fix: sync,
      });
    }
  }
  if (data.searchQueries?.truncated)
    gaps.push({
      message: "queriesTruncated",
      count: data.searchQueries.rowLimit,
      fix: null,
    });
  // Observations come newest first; a statistics sync has no tests.
  const newest = data.observations.find(
    ({ coverage }) =>
      coverage.checked + coverage.skipped + coverage.failed > 0 ||
      coverage.modules !== undefined,
  );
  // A date filter or a cut of the checks can hide a check: no check in view is then no proof of none.
  // A workspace read by an older Core has no evidenceLimited: either cut then counts.
  const partView = Boolean(
    data.scope.from ||
      data.scope.to ||
      (data.history.evidenceLimited ?? data.history.limited),
  );
  if (!newest) {
    if (!partView) gaps.push({ message: "noCheck", fix: check });
  } else {
    const { skipped, failed, modules } = newest.coverage;
    if (skipped > 0)
      gaps.push({ message: "notChecked", count: skipped, fix: check });
    if (failed > 0) gaps.push({ message: "failed", count: failed, fix: check });
    if (modules?.notRequestedNames?.length)
      gaps.push({
        message: "modulesNotRequested",
        names: modules.notRequestedNames,
        fix: check,
      });
    if (modules?.failedNames?.length)
      gaps.push({
        message: "modulesFailed",
        names: modules.failedNames,
        fix: check,
      });
  }
  if (canUsePaidSearchData === false)
    gaps.push({ message: "paidOff", fix: null });
  if (data.history.limited)
    gaps.push({
      message: "historyLimited",
      count: data.history.limit,
      fix: null,
    });
  return gaps;
}

/**
 * The ways to the missing features: each step, how many open items it unlocks, whether it is done, and the
 * connect action where the reader can take it here. Steps that unlock nothing are left out.
 */
export function seoUnlockSteps(
  data: ProjectSeoWorkspace,
  narrowed = false,
  catalog: readonly SeoCapability[] = SEO_CAPABILITIES,
) {
  const open = catalog.filter((item) => item.status !== "built");
  const connected = connectedSources(data);
  return SEO_CAPABILITY_UNLOCKS.map((unlock: SeoCapabilityUnlock) => {
    const done =
      unlock === "search_console" || unlock === "ga4"
        ? connected[unlock]
        : false;
    const connect: SeoAuditGapFix | null =
      done || narrowed || !data.availableActions.canSyncMetrics
        ? null
        : unlock === "search_console"
          ? "connect_search_console"
          : unlock === "ga4"
            ? "connect_ga4"
            : null;
    return {
      unlock,
      items: open.filter((item) => item.unlocks.includes(unlock)).length,
      done,
      connect,
    };
  }).filter((step) => step.items > 0);
}
