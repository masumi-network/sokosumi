import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { keywordGroups, keywordSummary } from "./seo-keyword-rows-model";
import {
  SEO_ISSUE_SEVERITY_NAMES,
  seoOverviewModel,
} from "./seo-overview-model";
import { normalizeQuery } from "./seo-search-model";

/**
 * Observations come newest first. Rankings and links reads carry no rule rows,
 * so the last check is the newest observation that asked for rule checks.
 */
export function lastRuleCheck(workspace: ProjectSeoWorkspace) {
  return (
    workspace.observations.find(
      ({ coverage }) =>
        coverage.checked + coverage.skipped + coverage.failed > 0 ||
        (coverage.modules?.failed ?? 0) > 0,
    ) ?? null
  );
}

/**
 * The saved results as a few numbers with their parts, for the tile row.
 * A tile is null where no saved evidence gives its number: a missing read is not a zero.
 */
export function seoSummary(workspace: ProjectSeoWorkspace) {
  const check = lastRuleCheck(workspace);
  const { issues, hasFailedChecks } = seoOverviewModel(workspace);
  const groups = keywordGroups(workspace.keywords).checked;
  const rankings = keywordSummary(groups);
  const read = groups.filter((group) => group.reads.length > 0);
  // One keyword read for two pages is one search term: its searches count once in the sum.
  // The keyword counts stay per row, as in the keywords tile and the table.
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
  // The same rule as the Agent verdict: a failed test in any check in view proves no clean result.
  const incomplete =
    check !== null && (check.coverage.checked === 0 || hasFailedChecks);
  const tests = check
    ? check.coverage.checked + check.coverage.skipped + check.coverage.failed
    : 0;
  return {
    // No issue after an incomplete check is no "0 issues": the tile stays away.
    issues:
      check && !(incomplete && issues.length === 0)
        ? {
            total: issues.length,
            parts: SEO_ISSUE_SEVERITY_NAMES.map((severity) => ({
              severity,
              count: issues.filter((issue) => issue.severity === severity)
                .length,
            })).filter((part) => part.count > 0),
          }
        : null,
    // Tests that gave a result, tests that could not decide, and tests the check could not run.
    tests:
      check && tests > 0
        ? {
            total: tests,
            decided: check.coverage.checked,
            undecided: check.coverage.skipped,
            unavailable: check.coverage.failed,
            observedAt: check.observedAt,
          }
        : null,
    keywords: rankings.read
      ? {
          read: rankings.read,
          found: rankings.found,
          firstPage: rankings.firstPage,
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
