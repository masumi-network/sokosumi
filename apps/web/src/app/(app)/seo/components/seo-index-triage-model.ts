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

/** Private assessments stay with the exact saved pages selected in this view. */
export function seoIndexAssessments(workspace: IndexTriageWorkspace) {
  const triage = workspace.indexTriage;
  if (!triage) return [];
  const selectedIds = new Set(workspace.scope.pageIds);
  const byUrl = new Map(
    triage.assessments.map((assessment) => [assessment.pageUrl, assessment]),
  );
  // Saved page order keeps the main audit page before its related pages.
  return workspace.pages.flatMap((page) => {
    const assessment = selectedIds.has(page.id) ? byUrl.get(page.url) : null;
    return assessment ? [assessment] : [];
  });
}

/** Issues belong to audit findings. This section keeps only non-issue review notes. */
export function seoIndexTriage(workspace: IndexTriageWorkspace) {
  const triage = workspace.indexTriage;
  if (!triage) return null;
  const assessments = seoIndexAssessments(workspace).filter(reviewNote);
  return assessments.length ? { assessments } : null;
}
