import { badRequest } from "@/helpers/error";
import type { PublicSeoPayload } from "./project-seo-report";

interface PartialCheck {
  id?: unknown;
  rowId: string;
  pageUrl: string;
  device: "mobile" | "desktop";
  result: string;
  analysis?: unknown;
  level?: unknown;
  evidence?: unknown;
  sourceRef?: unknown;
  observedAt?: unknown;
}
interface PartialActionReport {
  scope: { pageUrls: string[]; devices: string[] };
  checks: PartialCheck[];
  findings: PublicSeoPayload["findings"];
  actions: PublicSeoPayload["actions"];
}
const FAILURE_LEVELS = new Set(["critical", "major", "minor"]);

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function assertUniqueIds(rows: { id?: unknown }[]): void {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!hasText(row.id) || ids.has(row.id))
      throw badRequest("SEO action evidence requires unique nonempty IDs");
    ids.add(row.id);
  }
}

/** Partial recommendations must cite the exact confirmed HTML failures, never another page or diagnostic row. */
export function assertValidPartialSeoActions(
  report: PartialActionReport,
): void {
  // Old focused artifacts with no recommendations keep their existing format.
  if (!report.actions.length) return;
  assertUniqueIds(report.actions);
  assertUniqueIds(report.findings);
  assertUniqueIds(report.checks);
  const findings = new Map(report.findings.map((row) => [row.id, row]));
  const checks = new Map(report.checks.map((row) => [row.id, row]));
  const pages = new Set(report.scope.pageUrls);
  for (const action of report.actions) {
    const references = new Set<string>();
    if (!pages.has(action.pageUrl) || !action.findingIds.length)
      throw badRequest(
        "SEO actions must cite evidence for their selected page",
      );
    for (const id of action.findingIds) {
      if (!hasText(id) || references.has(id))
        throw badRequest(
          "SEO actions require unique nonempty finding references",
        );
      references.add(id);
      const finding = findings.get(id);
      const check = checks.get(id);
      if (
        !finding ||
        !check ||
        !FAILURE_LEVELS.has(finding.severity) ||
        check.result !== "fired" ||
        check.level !== finding.severity ||
        check.analysis !== "page.inspect" ||
        !hasText(finding.rowId) ||
        check.rowId !== finding.rowId ||
        finding.pageUrl !== action.pageUrl ||
        check.pageUrl !== finding.pageUrl ||
        finding.device !== check.device ||
        !report.scope.devices.includes(check.device) ||
        !hasText(finding.sourceRef) ||
        check.sourceRef !== finding.sourceRef ||
        check.observedAt !== finding.observedAt ||
        !finding.evidence.some(hasText) ||
        !Array.isArray(check.evidence) ||
        check.evidence.length !== finding.evidence.length ||
        check.evidence.some((value, index) => value !== finding.evidence[index])
      )
        throw badRequest(
          "The SEO action does not reference a confirmed failure for its page",
        );
    }
  }
}
