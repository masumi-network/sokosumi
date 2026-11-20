import {
  type AuditDiscovery,
  sitemapAddress,
} from "@/schemas/seo-sitemap-evidence.schema";
import { gscPropertyCovers } from "./native-gsc-property";

export function auditDiscoveryResult(
  evidence: AuditDiscovery,
  property: string,
  capturedRoots: string[],
) {
  const publicSitemaps = Array.from(
    new Set(
      capturedRoots.filter(
        (url) =>
          sitemapAddress.safeParse(url).success &&
          gscPropertyCovers(property, [url]),
      ),
    ),
  );
  const actions: { url: string; action: string; evidence: string }[] = [];
  for (const row of evidence.sitemaps) {
    if (row.pending) continue;
    if (row.errors && row.errors > 0)
      actions.push({
        url: row.path,
        action:
          "Open the sitemap error details in Search Console. Fix the reported entries and check the next Google read.",
        evidence: `Google reported ${row.errors} errors.`,
      });
    else if (row.warnings && row.warnings > 0)
      actions.push({
        url: row.path,
        action:
          "Check the sitemap warnings to see which entries Google could process.",
        evidence: `Google reported ${row.warnings} warnings.`,
      });
  }
  if (evidence.status === "available")
    for (const url of publicSitemaps) {
      if (!evidence.sitemaps.some((row) => row.path === url))
        actions.push({
          url,
          action:
            "Submit this existing sitemap in Search Console if you want Google’s processing history.",
          evidence:
            "The audit read this public sitemap. It did not appear in the submitted list for this property.",
        });
    }
  for (const page of evidence.inspections) {
    const reason = page.reason?.toLowerCase() ?? "";
    if (page.verdict === "PASS" || page.verdict === "VERDICT_UNSPECIFIED")
      continue;
    let action: string;
    if (/currently not indexed/.test(reason))
      action =
        "Check this page’s intended canonical and its contextual internal links. Compare the next URL inspection after a new Google crawl.";
    else if (/not found|soft 404|server error/.test(reason))
      action =
        "Check live HTTP status and incoming links. Repair the URL if it should exist, or update links that still point to it.";
    else if (/blocked by|noindex/.test(reason))
      action =
        "Confirm that this page should appear in search before changing its index directive or access settings.";
    else continue;
    actions.push({
      url: page.page,
      action,
      evidence: `Google’s URL inspection returned “${page.reason}”.`,
    });
  }
  return { ...evidence, publicSitemaps, actions };
}
