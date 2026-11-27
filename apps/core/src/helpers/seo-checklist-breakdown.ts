import type { z } from "@hono/zod-openapi";
import type { seoChecklistBreakdown } from "@/schemas/seo-audit-coverage.schema";
import type { PublicSeoPayload } from "./project-seo-report";
import { retainedResearchCoverage } from "./seo-research-coverage";

type Checks = PublicSeoPayload["checks"];
type Coverage = PublicSeoPayload["coverage"];
const MAX_REASON_CHARS = 1200;

export function focusedRuleCoverage(
  checks: Checks,
  modules?: Coverage["modules"],
): Coverage {
  let checked = 0,
    failed = 0,
    skipped = 0;
  for (const check of checks) {
    if (check.result === "blocked") failed++;
    else if (check.result === "not_checked") skipped++;
    else checked++;
  }
  return { checked, skipped, failed, ...(modules && { modules }) };
}

type WorkerCheck = {
  row: string;
  ruleKey?: string;
  pageOnly?: true;
  device: Checks[number]["device"];
  result: "pass" | "fired" | "blocked" | "not checked";
  sourceReason?: string;
  detail?: string;
};
export function readChecklist(
  rows: WorkerCheck[],
  notes: { item: string; reason: string }[],
  pageUrl: string,
  finalUrl?: Partial<Record<Checks[number]["device"], string | null>> | null,
): Checks {
  const reasons = new Map(notes.map((note) => [note.item, note.reason]));
  return rows.map((row) => {
    const result = row.result === "not checked" ? "not_checked" : row.result;
    const reason =
      result === "not_checked" || result === "blocked"
        ? row.sourceReason ||
          reasons.get(row.row + " on " + row.device) ||
          row.detail
        : undefined;
    const read = finalUrl?.[row.device];
    return {
      rowId: row.row,
      device: row.device,
      pageUrl,
      result,
      ...(reason && { reason: reason.slice(0, MAX_REASON_CHARS) }),
      ...(row.ruleKey && { ruleKey: row.ruleKey }),
      ...(row.pageOnly && { pageOnly: true as const }),
      ...(read && { finalUrl: read }),
    };
  });
}

export function scopedObservationChecks(
  data: PublicSeoPayload,
  selected: (url: string) => boolean,
) {
  const checks = data.checks.filter((c) => selected(c.pageUrl));
  const wholeReport = data.pageUrls.every(selected);
  const devices = [
    ...new Set(
      [
        ...checks,
        ...data.findings.filter((row) => selected(row.pageUrl)),
        ...data.keywords.filter((row) => selected(row.pageUrl)),
      ].flatMap((item) => (item.device ? [item.device] : [])),
    ),
  ];
  // Older focused payloads stored module counts in the rule coverage fields. Modules have no per-page scope.
  const modules =
    data.kind !== "audit_full" && wholeReport
      ? (data.coverage.modules ?? {
          notRequested: data.coverage.skipped,
          failed: data.coverage.failed,
        })
      : undefined;
  const noAuditRows = data.kind === "audit_full" && data.checks.length === 0;
  const aggregateOnly =
    noAuditRows &&
    data.coverage.checked + data.coverage.failed + data.coverage.skipped > 0;
  const coverage =
    wholeReport && noAuditRows
      ? data.coverage
      : focusedRuleCoverage(checks, modules);
  const research = (
    data.researchCoverage ?? retainedResearchCoverage(data)
  ).filter((p) =>
    p.scope === "site"
      ? wholeReport && selected(p.pageUrl)
      : selected(p.pageUrl),
  );
  if (!checks.length && !research.length) return { coverage, devices };
  // Flattened notes in historical site payloads have no page identity.
  const notes = new Map<string, string>();
  if (data.pageUrls.length === 1)
    for (const note of data.notes) {
      const end = note.indexOf(": ");
      if (end > 0) notes.set(note.slice(0, end), note.slice(end + 2));
    }
  const checklistBreakdown: z.infer<typeof seoChecklistBreakdown> = {
    passed: aggregateOnly
      ? null
      : checks.filter((c) => c.result === "pass").length,
    flagged: aggregateOnly
      ? null
      : checks.filter((c) => c.result === "fired").length,
    gaps: checks
      .filter((c) => c.result === "not_checked" || c.result === "blocked")
      .map((c) => ({
        rowId: c.rowId,
        pageUrl: c.pageUrl,
        device: c.device,
        reason: (
          c.reason ??
          notes.get(c.rowId + " on " + c.device) ??
          (c.result === "blocked"
            ? "The check was blocked."
            : "No reason was saved for this entry.")
        ).slice(0, MAX_REASON_CHARS),
      })),
    research,
  };
  return { coverage, devices, checklistBreakdown };
}
