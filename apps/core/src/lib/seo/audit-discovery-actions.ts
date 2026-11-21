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
          "Review the errors in Search Console. Fix the sitemap, then check again after Google reads it.",
        evidence: `Google reported ${row.errors} errors.`,
      });
    else if (row.warnings && row.warnings > 0)
      actions.push({
        url: row.path,
        action: "Review the sitemap warnings in Search Console.",
        evidence: `Google reported ${row.warnings} warnings.`,
      });
  }
  if (evidence.status === "available")
    for (const url of publicSitemaps) {
      if (!evidence.sitemaps.some((row) => row.path === url))
        actions.push({
          url,
          action: "Submit this sitemap to see when Google reads it.",
          evidence:
            "The sitemap is public. Search Console didn’t list it as submitted for this site.",
        });
    }
  for (const page of evidence.inspections) {
    const reason = page.reason?.toLowerCase() ?? "";
    if (page.verdict === "PASS" || page.verdict === "VERDICT_UNSPECIFIED")
      continue;
    let action: string;
    if (/currently not indexed/.test(reason))
      action =
        "Check which URL should appear in search and which pages link to it. Inspect it again after Google revisits.";
    else if (/not found|soft 404|server error/.test(reason))
      action =
        "Open the URL. If it should work, fix it. Otherwise, update links that point to it.";
    else if (/blocked by|noindex/.test(reason))
      action =
        "Check whether this page should appear in search before unblocking it.";
    else continue;
    actions.push({
      url: page.page,
      action,
      evidence: `Google’s URL inspection returned “${page.reason}”.`,
    });
  }
  return { ...evidence, publicSitemaps, actions };
}
