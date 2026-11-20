import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { keywordGroups, keywordSummary } from "./seo-keyword-rows-model";
import {
  SEO_ISSUE_SEVERITY_NAMES,
  seoOverviewModel,
} from "./seo-overview-model";
import { isSeoRuleCheck, seoRunDays } from "./seo-runs-model";
import { normalizeQuery } from "./seo-search-model";

/** Use the rule check at the selected timeline stop, or the newest rule check inside a date range. */
export function lastRuleCheck(workspace: ProjectSeoWorkspace) {
  const { scope, observations } = workspace;
  const stop = seoRunDays(workspace, scope).days.find((day) => day.selected);
  if (stop) return observations.find((row) => row.id === stop.check) ?? null;
  return observations.find((row) => isSeoRuleCheck(row.kind)) ?? null;
}

/** Core has already removed older findings superseded by a later verdict. */
export function seoIssueScope(
  workspace: ProjectSeoWorkspace,
  issues: ReturnType<typeof seoOverviewModel>["issues"],
) {
  const check = lastRuleCheck(workspace);
  // Without a dated observation there is no basis for calling a finding historical.
  if (!check && !workspace.observations.length && !workspace.runs?.length)
    return { check, current: issues, earlier: [], total: null };
  const current = issues.filter((row) => row.observationId === check?.id);
  const earlier = issues.filter((row) => row.observationId !== check?.id);
  if (!check) return { check, current, earlier, total: null };
  const run = workspace.runs?.find((row) => row.observationId === check.id);
  if (run) return { check, current, earlier, total: run.issues };

  // Workspaces saved before the timeline still carry the scoped observation count.
  const fullScope = workspace.scope.pageIds.every((id) =>
    check.pageIds.includes(id),
  );
  const complete =
    check.coverage.checked > 0 &&
    !check.coverage.failed &&
    !check.coverage.modules?.failed;
  const total =
    fullScope && (check.issues > 0 || complete) ? check.issues : null;
  return { check, current, earlier, total };
}

/** The latest full audit with saved research can predate a focused page check. */
export function lastAuditResearch(workspace: ProjectSeoWorkspace) {
  return workspace.observations.find(
    (check) =>
      check.kind === "audit_full" && check.checklistBreakdown?.research.length,
  );
}

/**
 * The saved results as a few numbers with their parts, for the tile row.
 * A tile is null where no saved evidence gives its number: a missing read is not a zero.
 */
export function seoSummary(workspace: ProjectSeoWorkspace) {
  const { check, current, total } = seoIssueScope(
    workspace,
    seoOverviewModel(workspace).issues,
  );
  const groups = keywordGroups(workspace.keywords).checked;
  const rankings = keywordSummary(groups);
  const read = groups.filter((group) => group.reads.length > 0);
  // One keyword read for two pages is one search term: its searches count once in the sum.
  // The keyword counts stay per row, as in the keyword figure and the table.
  const terms = [
    ...Map.groupBy(read, ({ lead }) =>
      JSON.stringify([
        normalizeQuery(lead.keyword),
        lead.countryCode,
        lead.languageCode,
      ]),
    ).values(),
  ].map((pages) => pages.find((group) => group.volume !== null)?.volume ?? 0);
  const measured = read.filter((group) => group.volume !== null).length;
  const tests = check
    ? check.coverage.checked + check.coverage.skipped + check.coverage.failed
    : 0;
  return {
    issues:
      total === null
        ? null
        : {
            total,
            // A retained aggregate may have fewer detail rows. Only show a complete severity breakdown.
            parts:
              current.length === total
                ? SEO_ISSUE_SEVERITY_NAMES.map((severity) => ({
                    severity,
                    count: current.filter(
                      (issue) => issue.severity === severity,
                    ).length,
                  })).filter((part) => part.count > 0)
                : [],
          },
    // Tests that gave a result, tests that could not decide, and tests the check could not run.
    tests:
      check && tests > 0
        ? {
            total: tests,
            decided: check.coverage.checked,
            undecided: check.coverage.skipped,
            unavailable: check.coverage.failed,
            observedAt: check.observedAt,
            observationId: check.id,
          }
        : null,
    keywords: rankings.read
      ? {
          read: rankings.read,
          found: rankings.found,
          depth: rankings.depth,
        }
      : null,
    // Monthly searches of the keywords with a position read; a keyword without a volume adds nothing.
    searches: measured
      ? {
          total: terms.reduce((sum, volume) => sum + volume, 0),
          keywords: measured,
          of: read.length,
        }
      : null,
  };
}

export type SeoSummary = ReturnType<typeof seoSummary>;

/**
 * The checked keywords with the most monthly searches, largest first, for the Agent tab's picture.
 * One keyword read for two pages is one row with its best position. A keyword without a known
 * count has no bar, and one bar is no comparison.
 */
export function seoKeywordDemand(
  workspace: ProjectSeoWorkspace,
  limit: number,
) {
  const read = keywordGroups(workspace.keywords).checked.filter(
    (group) => group.reads.length > 0,
  );
  const rows = [
    ...Map.groupBy(read, ({ lead }) =>
      JSON.stringify([
        normalizeQuery(lead.keyword),
        lead.countryCode,
        lead.languageCode,
      ]),
    ).values(),
  ]
    .map((pages) => {
      const ranks = pages.flatMap(({ best }) => (best === null ? [] : [best]));
      return {
        keyword: pages[0].lead.keyword,
        countryCode: pages[0].lead.countryCode,
        languageCode: pages[0].lead.languageCode,
        volume: pages.find((group) => group.volume !== null)?.volume ?? 0,
        best: ranks.length ? Math.min(...ranks) : null,
      };
    })
    .filter((row) => row.volume > 0)
    .toSorted((left, right) => right.volume - left.volume)
    .slice(0, limit);
  return rows.length > 1
    ? {
        rows,
        max: rows[0].volume,
        // One keyword read in two markets is two rows: each then names its market.
        manyMarkets:
          new Set(
            rows.map((row) =>
              JSON.stringify([row.countryCode, row.languageCode]),
            ),
          ).size > 1,
      }
    : { rows: [], max: 0, manyMarkets: false };
}

/** About this many steps on the demand axis. */
const DEMAND_AXIS_STEPS = 4;

/**
 * A round axis for the demand bars: steps of 1, 2 or 5 times a power of ten,
 * whole searches only, ending at or above the largest count.
 */
export function seoDemandAxis(max: number) {
  const rough = Math.max(1, max) / DEMAND_AXIS_STEPS;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(
    1,
    [1, 2, 5, 10]
      .map((factor) => factor * power)
      .find((value) => value >= rough) ?? 10 * power,
  );
  const top = Math.max(step, Math.ceil(max / step) * step);
  return {
    top,
    ticks: Array.from({ length: top / step + 1 }, (_, index) => index * step),
  };
}
