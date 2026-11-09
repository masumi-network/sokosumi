import type { ProjectSeoWorkspace } from "@sokosumi/core-client";

const ISSUE_SEVERITIES = { critical: 0, major: 1, minor: 2 } as const;
const NON_ISSUE_RANK = Object.keys(ISSUE_SEVERITIES).length;

type Finding = ProjectSeoWorkspace["findings"][number];
type Action = ProjectSeoWorkspace["actions"][number];

function issueRank(finding: Finding): number {
  return finding.severity in ISSUE_SEVERITIES
    ? ISSUE_SEVERITIES[finding.severity as keyof typeof ISSUE_SEVERITIES]
    : NON_ISSUE_RANK;
}

/** Severity describes an issue. Measurements and notes do not imply a fix. */
export function seoOverviewModel(workspace: ProjectSeoWorkspace) {
  const issues = workspace.findings
    .filter((finding) => issueRank(finding) < NON_ISSUE_RANK)
    .toSorted((left, right) => issueRank(left) - issueRank(right));
  // Each device of one check can report the same measurement; one check shows it once.
  const diagnostics = [
    ...new Map(
      workspace.findings
        .filter((finding) => issueRank(finding) === NON_ISSUE_RANK)
        .map((finding) => [
          JSON.stringify([
            finding.observationId,
            finding.severity,
            finding.title,
            finding.pageUrl,
            finding.evidence,
          ]),
          finding,
        ]),
    ).values(),
  ];
  const findingRanks = new Map(
    issues.map((finding) => [finding.id, issueRank(finding)]),
  );
  const actionRank = (action: Action) =>
    Math.min(
      NON_ISSUE_RANK,
      ...action.findingIds.map((id) => findingRanks.get(id) ?? NON_ISSUE_RANK),
    );
  // Preserve strategic proposals without findings and all existing Task history.
  const actions = workspace.actions.toSorted(
    (left, right) => actionRank(left) - actionRank(right),
  );
  const recommendedActions = actions.filter(
    (action) => action.status === "recommended",
  );
  const recentChecks = workspace.analyses.filter(
    (analysis) => analysis.status !== "completed",
  );
  const hasCheckedEvidence = workspace.observations.some(
    (observation) => observation.coverage.checked > 0,
  );
  const hasFailedChecks =
    workspace.observations.some(
      (observation) =>
        observation.coverage.failed > 0 ||
        (observation.coverage.modules?.failed ?? 0) > 0,
    ) ||
    (!hasCheckedEvidence &&
      workspace.analyses.some((analysis) => analysis.status === "failed"));
  const emptyState = issues.length
    ? "issues"
    : hasFailedChecks
      ? "incomplete"
      : hasCheckedEvidence
        ? "no_fixes"
        : "no_checks";
  return {
    issues,
    diagnostics,
    actions,
    recommendedActions,
    recentChecks,
    hasFailedChecks,
    emptyState,
  };
}

/**
 * Per page in the current view: open issues and the newest check that covered it.
 * The workspace holds findings and checks only for the viewed pages and dates, so a
 * page outside the view gets no summary rather than a false "no issues". A cut history
 * cannot prove a page was never checked, so such a page gets no summary either.
 */
export function seoPageSummaries(workspace: ProjectSeoWorkspace) {
  const { issues } = seoOverviewModel(workspace);
  const viewed = new Set(workspace.scope.pageIds);
  const summaries = new Map<
    string,
    {
      issues: number;
      checkedAt: Date | string | null;
      checkId: string | null;
      incomplete: boolean;
    }
  >();
  for (const page of workspace.pages) {
    if (!viewed.has(page.id)) continue;
    // Observations come newest first.
    // A check where every rule was unavailable still ran; one that skipped every rule did not.
    const check = workspace.observations.find(
      ({ coverage, pageIds }) =>
        (coverage.checked > 0 ||
          coverage.failed > 0 ||
          (coverage.modules?.failed ?? 0) > 0) &&
        pageIds.includes(page.id),
    );
    if (!check && workspace.history.limited) continue;
    summaries.set(page.id, {
      issues: issues.filter((finding) => finding.pageUrl === page.url).length,
      checkedAt: check?.observedAt ?? null,
      // Only a check with a Task has results to open.
      checkId: check?.sourceTaskId ? check.id : null,
      // A check with unavailable rules cannot say "no issues", as on the Overview.
      incomplete: Boolean(
        check &&
          (check.coverage.failed > 0 ||
            (check.coverage.modules?.failed ?? 0) > 0),
      ),
    });
  }
  return summaries;
}
