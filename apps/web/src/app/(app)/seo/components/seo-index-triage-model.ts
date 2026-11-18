import type { ProjectSeoWorkspace } from "@sokosumi/core-client";

type IndexTriageWorkspace = Pick<
  ProjectSeoWorkspace,
  "indexTriage" | "pages" | "scope"
>;

type IndexAssessment = NonNullable<
  ProjectSeoWorkspace["indexTriage"]
>["assessments"][number];
type ReviewAssessment = IndexAssessment & {
  status: "review" | "expected_exclusion" | "unavailable";
};
const REVIEW_STATES = new Set<IndexAssessment["status"]>([
  "review",
  "expected_exclusion",
  "unavailable",
]);
const reviewNote = (
  assessment: IndexAssessment,
): assessment is ReviewAssessment => REVIEW_STATES.has(assessment.status);

/** Private related evidence stays with its selected audited parent, without adding a saved page. */
export function seoIndexAssessments(workspace: IndexTriageWorkspace) {
  const triage = workspace.indexTriage;
  if (!triage) return [];
  const selectedIds = new Set(workspace.scope.pageIds);
  const selected = new Map(
    workspace.pages
      .filter((page) => selectedIds.has(page.id))
      .map((page, index) => [page.url, index]),
  );
  const parent = (assessment: IndexAssessment) =>
    assessment.auditPageUrl ?? assessment.pageUrl;
  return triage.assessments
    .filter((assessment) => selected.has(parent(assessment)))
    .toSorted(
      (left, right) =>
        selected.get(parent(left))! - selected.get(parent(right))!,
    );
}

/** Issues belong to audit findings. This section keeps only non-issue review notes. */
export function seoIndexTriage(workspace: IndexTriageWorkspace) {
  const triage = workspace.indexTriage;
  if (!triage) return null;
  const assessments = seoIndexAssessments(workspace).filter(reviewNote);
  return assessments.length ? { assessments } : null;
}
