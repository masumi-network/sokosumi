import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { newerSeoAuditVerdict, seoInspectionEvidence } from "@sokosumi/utils";

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
export function seoIndexTriage(
  workspace: IndexTriageWorkspace,
  scoped = seoIndexAssessments(workspace),
) {
  const assessments = scoped.filter(reviewNote);
  return assessments.length ? { assessments } : null;
}

/** Keep each selected page's newest confirmed verdict separate from its audit findings and review notes. */
export function seoIndexStatusView(
  workspace: IndexTriageWorkspace & Pick<ProjectSeoWorkspace, "indexStatus">,
) {
  const inView = new Set(
    workspace.pages
      .filter((page) => workspace.scope.pageIds.includes(page.id))
      .map((page) => page.url),
  );
  const assessments = seoIndexAssessments(workspace);
  const pages = [...inView].flatMap((pageUrl) => {
    const synced = workspace.indexStatus?.pages.find(
      (page) => page.pageUrl === pageUrl,
    );
    const audit = newerSeoAuditVerdict(pageUrl, synced?.checkedAt, assessments);
    if (!audit) return synced ? [synced] : [];
    const { crawledAt } = seoIndexEvidence(audit.assessment.evidence);
    return [
      {
        pageUrl,
        verdict: audit.verdict,
        checkedAt: audit.assessment.checkedAt,
        coverageState: audit.coverageState,
        lastCrawlTime: crawledAt,
        googleCanonical: null,
        userCanonical: null,
        robotsTxtState: null,
      },
    ];
  });
  const notes = seoIndexTriage(workspace, assessments)?.assessments ?? [];
  const alone = notes.filter(
    (note) => !pages.some((page) => page.pageUrl === note.pageUrl),
  );
  const answered = new Set(pages.map((page) => page.pageUrl));
  for (const page of assessments)
    if (page.status !== "unavailable") answered.add(page.pageUrl);
  const unanswered = [...inView].filter((url) => !answered.has(url)).length;
  return { inView, pages, notes, alone, unanswered };
}

// The lines the SEO coworker writes for a page (seo-bot agent/lib/indexing-triage.ts).
const LAST_CRAWL = /^Google last crawled this URL at (.+)\.$/;
const GOOGLE_STATE = /^(indexingState|robotsTxtState|pageFetchState): (.+)$/;
/** States that say nothing is wrong: they are noise next to the reason. */
const STATE_OK = new Set(["INDEXING_ALLOWED", "ALLOWED", "SUCCESSFUL"]);
/** A line that only records how the review ran: it says nothing about the page. */
const RECORD_ONLY = /^Public page evidence was captured at /;

/**
 * Google's reason and last crawl from an assessment's evidence, and the lines left that say something more: a state
 * that is not fine, a verdict without a reason, a missing crawl time, a robots.txt line. The lines stay stored as they are; this picks what the card shows.
 */
export function seoIndexEvidence(evidence: readonly string[]) {
  let reason: string | null = null;
  let crawledAt: Date | null = null;
  const more: string[] = [];
  for (const line of evidence) {
    const inspection = seoInspectionEvidence(line);
    if (inspection?.coverageState) {
      reason = inspection.coverageState;
      continue;
    }
    const crawl = LAST_CRAWL.exec(line);
    const crawled = crawl ? new Date(crawl[1]) : null;
    if (crawled && !Number.isNaN(crawled.getTime())) {
      crawledAt = crawled;
      continue;
    }
    const state = GOOGLE_STATE.exec(line);
    if (state && (STATE_OK.has(state[2]) || state[2].endsWith("_UNSPECIFIED")))
      continue;
    if (RECORD_ONLY.test(line)) continue;
    more.push(line);
  }
  return { reason, crawledAt, more };
}
