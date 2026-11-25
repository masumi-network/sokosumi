import type { SeoAuditSummary } from "@sokosumi/core-client";
import { SEO_CHECK_STALE_MS } from "./seo-setup-model";

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
