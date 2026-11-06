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
  const diagnostics = workspace.findings.filter(
    (finding) => issueRank(finding) === NON_ISSUE_RANK,
  );
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
