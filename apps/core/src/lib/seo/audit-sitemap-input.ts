import { isPublicSeoSitemapPage } from "@sokosumi/utils";
import { badRequest } from "@/helpers/error";
import {
  type RequestSeoAnalysis,
  SEO_MAX_PAGES,
} from "@/schemas/project-seo.schema";
import { requireSeoEvidenceUrl } from "./related-page-selection";

export function auditSitemapInput(input: RequestSeoAnalysis, pages: string[]) {
  const { publicSitemapUrl, sitemapPageHints } = input;
  if (!publicSitemapUrl && !sitemapPageHints) return {};
  const seed = pages[0];
  if (pages.length >= SEO_MAX_PAGES)
    throw badRequest("Leave room for related pages when adding sitemap inputs");
  if (
    !seed ||
    input.kind !== "audit_full" ||
    (!input.fullAuditPrice && input.fullAuditCredits === undefined)
  )
    throw badRequest(
      "Sitemap inputs require a full audit with an approved price",
    );
  const primary = new URL(seed);
  for (const url of [
    ...(publicSitemapUrl ? [publicSitemapUrl] : []),
    ...(sitemapPageHints ?? []),
  ]) {
    const parsed = new URL(url);
    // The worker fetches a bare/www hint only after a verified redirect and robots read at that origin.
    const hostMatches =
      parsed.hostname === primary.hostname ||
      parsed.hostname === "www." + primary.hostname ||
      primary.hostname === "www." + parsed.hostname;
    if (
      !hostMatches ||
      parsed.port !== primary.port ||
      (parsed.protocol !== primary.protocol && parsed.protocol !== "https:") ||
      !/\.(?:[a-z]{2,}|xn--[a-z0-9-]+)$/i.test(parsed.hostname)
    )
      throw badRequest(
        "Sitemap inputs must use the selected site's public host",
      );
    requireSeoEvidenceUrl(
      url,
      seed,
      url === publicSitemapUrl,
      undefined,
      parsed.origin,
    );
    if (url !== publicSitemapUrl && !isPublicSeoSitemapPage(url))
      throw badRequest("Sitemap imports require public page URLs");
  }
  if (publicSitemapUrl && !/\.xml$/i.test(new URL(publicSitemapUrl).pathname))
    throw badRequest("Supply the public URL of an XML sitemap");
  if (sitemapPageHints?.includes(publicSitemapUrl ?? ""))
    throw badRequest("Import page URLs from a sitemap URL set");
  return {
    ...(publicSitemapUrl && { publicSitemapUrl }),
    ...(sitemapPageHints && { sitemapPageHints }),
  };
}
