import type { ProjectSeoObservation } from "@sokosumi/database";

import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import type {
  ProjectSeoWorkspace,
  SeoIndexedPage,
  SeoWorkspaceQuery,
} from "@/schemas/project-seo.schema";
import { seoTaskIndexingResultSchema } from "@/schemas/seo-task-indexing.schema";
import { matchesSeoPeriod, normalizeSeoUrl } from "./project-seo-store";

const INDEXING_ROW_ID = "AC-20";

/** The newest verdict per selected page; observations arrive newest first. */
export function newestIndexStatus(
  sources: Array<{ at: Date; pages: SeoIndexedPage[] }>,
  selectedUrls: Set<string>,
): ProjectSeoWorkspace["indexStatus"] {
  const pages = new Map<string, SeoIndexedPage & { checkedAt: string }>();
  for (const source of sources)
    for (const page of source.pages) {
      const url = normalizeSeoUrl(page.pageUrl);
      if (selectedUrls.has(url) && !pages.has(url))
        pages.set(url, { ...page, checkedAt: source.at.toISOString() });
    }
  return pages.size ? { pages: [...pages.values()] } : null;
}

/** Only the requesting viewer's private rows are loaded by the workspace service. */
export function newestIndexTriage(
  observations: ProjectSeoObservation[],
  selectedUrls: Set<string>,
  taskForPage?: ReadonlyMap<string, string>,
): ProjectSeoWorkspace["indexTriage"] {
  const newest = new Map<
    string,
    NonNullable<ProjectSeoWorkspace["indexTriage"]>["assessments"][number]
  >();
  for (const row of observations) {
    if (
      row.kind !== "index_triage" ||
      row.source !== "seo_worker" ||
      row.visibility !== "PRIVATE" ||
      !row.ownerId
    )
      continue;
    const parsed = seoTaskIndexingResultSchema.safeParse(row.payload);
    if (!parsed.success || parsed.data.taskId !== row.sourceTaskId) continue;
    for (const page of parsed.data.assessments) {
      const url = normalizeSeoUrl(page.pageUrl);
      if (
        selectedUrls.has(url) &&
        !newest.has(url) &&
        (!taskForPage || taskForPage.get(url) === parsed.data.taskId)
      ) {
        newest.set(url, {
          ...page,
          taskId: parsed.data.taskId,
          checkedAt: parsed.data.checkedAt,
        });
      }
    }
  }
  return newest.size ? { assessments: [...newest.values()] } : null;
}

/** Private Console issues join the associated audit, not an unrelated check or a separate public artifact. */
export function indexAuditFindings(
  privateRows: ProjectSeoObservation[],
  auditRows: ProjectSeoObservation[],
  selectedUrls: Set<string>,
  query: SeoWorkspaceQuery,
) {
  const findings: ProjectSeoWorkspace["findings"] = [];
  const counts = new Map<string, number>();
  const latestPage = new Map<string, string>();
  for (const audit of auditRows) {
    if (audit.kind !== "audit_full" || !audit.sourceTaskId) continue;
    const payload = publicSeoPayloadSchema.safeParse(audit.payload);
    if (!payload.success) continue;
    const source = privateRows.find(
      (row) =>
        row.kind === "index_triage" &&
        row.source === "seo_worker" &&
        row.visibility === "PRIVATE" &&
        row.ownerId &&
        row.sourceTaskId === audit.sourceTaskId,
    );
    const triage =
      source && seoTaskIndexingResultSchema.safeParse(source.payload);
    const valid =
      triage?.success && triage.data.taskId === audit.sourceTaskId
        ? triage.data
        : null;
    const visibleDate = matchesSeoPeriod(audit.observedAt, query);
    for (const pageUrl of payload.data.pageUrls) {
      const normalized = normalizeSeoUrl(pageUrl);
      if (!selectedUrls.has(normalized)) continue;
      const assessment = valid?.assessments.find(
        (page) => normalizeSeoUrl(page.pageUrl) === normalized,
      );
      const duplicate = payload.data.findings.some(
        (finding) =>
          finding.rowId === INDEXING_ROW_ID &&
          normalizeSeoUrl(finding.pageUrl) === normalized,
      );
      if (assessment?.report && assessment.status === "issue" && !duplicate)
        counts.set(audit.id, (counts.get(audit.id) ?? 0) + 1);
      if (!visibleDate || latestPage.has(normalized)) continue;
      // A newer audit without a Console issue must never inherit an older audit's Console finding.
      latestPage.set(normalized, audit.sourceTaskId);
      if (
        !assessment?.report ||
        assessment.status !== "issue" ||
        duplicate ||
        !valid
      )
        continue;
      findings.push({
        id: `${audit.id}:google-index:${normalized}`,
        observationId: audit.id,
        pageUrl,
        device: null,
        rowId: INDEXING_ROW_ID,
        title: "Google Search Console indexing",
        severity: "major",
        evidence: [
          assessment.reason,
          ...assessment.evidence,
          `Google indexing status checked at ${valid.checkedAt}.`,
        ],
        suggestedFix: assessment.suggestedFix,
        visibility: "PRIVATE",
        sourceRef: valid.receiptHash,
        observedAt: valid.checkedAt,
      });
    }
  }
  return {
    findings,
    counts,
    triage: newestIndexTriage(privateRows, selectedUrls, latestPage),
  };
}

/** The same private issues count once in that viewer's audit summary and timeline. */
export function withIndexIssueCounts<
  T extends { id?: string; observationId?: string; issues: number | null },
>(rows: T[], counts: Map<string, number>): T[] {
  return rows.map((row) =>
    row.issues === null
      ? row
      : {
          ...row,
          issues:
            row.issues + (counts.get(row.id ?? row.observationId ?? "") ?? 0),
        },
  );
}
