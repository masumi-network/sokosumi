import type { SeoAuditSummary } from "@sokosumi/core-client";
import { SEO_CHECK_STALE_MS } from "./seo-setup-model";

/** Core's largest Audit list page. */
export const SEO_AUDIT_LIST_PAGE_MAX = 100;

export type SeoAuditLastCheck = NonNullable<SeoAuditSummary["lastCheck"]>;
export type SeoAuditCheckState =
  | "running"
  | "failed"
  | "unfinished"
  | "finished";

/**
 * What the audit list says about an audit's newest check. A check still open after the longest check could run
 * did not finish: Core has no end for a check whose Task ended without a result.
 */
export function seoAuditCheckState(
  check: SeoAuditLastCheck,
  now: Date,
): SeoAuditCheckState {
  if (check.status === "completed") return "finished";
  if (check.status === "failed") return "failed";
  return now.getTime() - new Date(check.createdAt).getTime() <
    SEO_CHECK_STALE_MS
    ? "running"
    : "unfinished";
}

/** How often the Audit list reads again while a check is open. */
export const SEO_AUDIT_LIST_REFRESH_MS = 15_000;

/**
 * When the Audit list reads again: only while an Audit's newest check is still requested or running. A check
 * that is `unfinished` never ends by itself, so it must not keep the list polling.
 */
export function seoAuditListRefetchMs(
  audits: Pick<SeoAuditSummary, "lastCheck">[],
  now: Date,
): number | false {
  return audits.some(
    ({ lastCheck }) =>
      lastCheck && seoAuditCheckState(lastCheck, now) === "running",
  )
    ? SEO_AUDIT_LIST_REFRESH_MS
    : false;
}
