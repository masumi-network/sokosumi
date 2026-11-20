import type { ProjectSeoObservation } from "@sokosumi/database";

import { publicSeoPayloadSchema } from "@/helpers/project-seo-report";
import {
  type ProjectSeoWorkspace,
  SEO_MAX_INDEX_ASSESSMENTS,
  type SeoIndexedPage,
  type SeoWorkspaceQuery,
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
  for (const source of sources.toSorted(
    (a, b) => b.at.getTime() - a.at.getTime(),
  ))
    for (const page of source.pages) {
      const url = normalizeSeoUrl(page.pageUrl);
      if (selectedUrls.has(url) && !pages.has(url))
        pages.set(url, { ...page, checkedAt: source.at.toISOString() });
    }
  return pages.size ? { pages: [...pages.values()] } : null;
}

/** A related URL belongs to this Task's audited parent, never to an unrelated selected page. */
function assessmentParent(
  pageUrl: string,
  auditPageUrl: string | undefined,
  auditedUrls: ReadonlySet<string>,
) {
  const url = normalizeSeoUrl(pageUrl);
  if (auditedUrls.has(url)) return url;
  if (!auditPageUrl) return null;
  const parent = normalizeSeoUrl(auditPageUrl);
  return auditedUrls.has(parent) && new URL(url).host === new URL(parent).host
    ? parent
    : null;
}

/** Only the requesting viewer's private rows are loaded by the workspace service. */
export function newestIndexTriage(
  observations: ProjectSeoObservation[],
  selectedUrls: Set<string>,
  taskForPage?: ReadonlyMap<string, string>,
  auditedPagesForTask?: ReadonlyMap<string, ReadonlySet<string>>,
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
    const audited = auditedPagesForTask?.get(parsed.data.taskId);
    for (const page of parsed.data.assessments) {
      const url = normalizeSeoUrl(page.pageUrl);
      // A parent association is usable only after the matching public audit established its exact scope.
      const parent = audited
        ? assessmentParent(url, parsed.data.auditPageUrl, audited)
        : selectedUrls.has(url)
          ? url
          : null;
      if (
        !parent ||
        !selectedUrls.has(parent) ||
        (taskForPage && taskForPage.get(parent) !== parsed.data.taskId)
      )
        continue;
      const key = JSON.stringify([parent, url]);
      if (newest.has(key)) continue;
      newest.set(key, {
        ...page,
        ...(parent !== url ? { auditPageUrl: parent } : {}),
        taskId: parsed.data.taskId,
        checkedAt: page.checkedAt ?? parsed.data.checkedAt,
      });
    }
  }
  return newest.size
    ? { assessments: [...newest.values()].slice(0, SEO_MAX_INDEX_ASSESSMENTS) }
    : null;
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
  const auditedPagesForTask = new Map<string, ReadonlySet<string>>();
  for (const audit of auditRows) {
    if (audit.kind !== "audit_full" || !audit.sourceTaskId) continue;
    const payload = publicSeoPayloadSchema.safeParse(audit.payload);
    if (!payload.success) continue;
    const audited = new Set(payload.data.pageUrls.map(normalizeSeoUrl));
    auditedPagesForTask.set(audit.sourceTaskId, audited);
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
      const duplicate = payload.data.findings.some(
        (finding) =>
          finding.rowId === INDEXING_ROW_ID &&
          normalizeSeoUrl(finding.pageUrl) === normalized,
      );
      const assessments = new Map(
        (valid?.assessments ?? [])
          .filter(
            (page) =>
              assessmentParent(page.pageUrl, valid?.auditPageUrl, audited) ===
              normalized,
          )
          .map((page) => [normalizeSeoUrl(page.pageUrl), page]),
      );
      const issues = [...assessments].filter(
        ([url, page]) =>
          page.report &&
          page.status === "issue" &&
          !(duplicate && url === normalized),
      );
      if (issues.length)
        counts.set(audit.id, (counts.get(audit.id) ?? 0) + issues.length);
      if (!visibleDate || latestPage.has(normalized)) continue;
      // A newer audit without a Console issue must never inherit an older audit's Console finding.
      latestPage.set(normalized, audit.sourceTaskId);
      if (!valid) continue;
      for (const [url, assessment] of issues)
        findings.push({
          id: `${audit.id}:google-index:${url}`,
          observationId: audit.id,
          pageUrl,
          ...(url !== normalized ? { relatedPageUrl: assessment.pageUrl } : {}),
          device: null,
          rowId: INDEXING_ROW_ID,
          title: "Google Search Console indexing",
          severity: "major",
          evidence: [
            assessment.reason,
            ...assessment.evidence,
            `Google indexing status checked at ${assessment.checkedAt ?? valid.checkedAt}.`,
          ],
          suggestedFix: assessment.suggestedFix,
          visibility: "PRIVATE",
          sourceRef: valid.receiptHash,
          observedAt: assessment.checkedAt ?? valid.checkedAt,
        });
    }
  }
  return {
    findings,
    counts,
    triage: newestIndexTriage(
      privateRows,
      selectedUrls,
      latestPage,
      auditedPagesForTask,
    ),
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
