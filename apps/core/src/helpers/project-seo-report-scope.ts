import { badRequest } from "@/helpers/error";
import { skippedPages } from "./project-seo-public-report";
import { auditedSeoPageKey } from "./project-seo-site-findings";

/**
 * The pages a report may name: the frozen pages of its request, then the pages
 * the audit added. A full audit adds pages by itself (owner decision
 * 2026-11-22), at most the count its frozen request names. The worker decides
 * which hosts are the site, because it follows the redirects of the first
 * page. So Core limits only the count of added pages.
 */
export function seoReportPageScope(
  raw: unknown,
  reportedUrls: string[],
  request: { pageUrls: string[]; autoPages?: number },
  fullAudit: boolean,
): { scope: string[]; reported: string[] } {
  const frozen = request.pageUrls.map(auditedSeoPageKey),
    reported = reportedUrls.map(auditedSeoPageKey),
    skipped = skippedPages(raw).map((page) => auditedSeoPageKey(page.url));
  const added = [...new Set([...reported, ...skipped])].filter(
    (url) => !frozen.includes(url),
  );
  // Every frozen page is reported or named as skipped, never both.
  if (
    new Set(reported).size !== reported.length ||
    added.length > (fullAudit ? (request.autoPages ?? 0) : 0) ||
    frozen.some((url) => !reported.includes(url) && !skipped.includes(url)) ||
    skipped.some((url) => reported.includes(url))
  )
    throw badRequest(
      "The report does not match its frozen page scope or Market",
    );
  return { scope: [...frozen, ...added], reported };
}
