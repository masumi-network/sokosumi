import { z } from "@hono/zod-openapi";
import {
  type SeoTaskIndexedPage,
  seoTaskIndexedPageSchema,
} from "@/schemas/seo-task-indexing.schema";
import { inspectionDiscoverySources } from "./audit-sitemaps";
import { normalizeGscInspection } from "./native-gsc-inspection";
import { gscPropertyCovers } from "./native-gsc-property";
import { requireSeoEvidenceUrl } from "./related-page-selection";

const detailsSchema = z.object({
  inspectionResult: z.object({
    indexStatusResult: z.object({
      pageFetchState: z.string().max(100).optional(),
    }),
  }),
});

/** Reuse the display parser for the indexing state and retain the page fetch state needed by the worker's triage. */
export function normalizeGscTaskInspection(
  pageUrl: string,
  input: unknown,
): SeoTaskIndexedPage {
  const details = detailsSchema.parse(input).inspectionResult.indexStatusResult;
  const page = normalizeGscInspection(pageUrl, input);
  const safeCanonical = (value: string | null) => {
    if (!value) return null;
    const url = new URL(value);
    return url.username || url.password ? null : value;
  };
  return seoTaskIndexedPageSchema.parse({
    ...page,
    googleCanonical: safeCanonical(page.googleCanonical),
    userCanonical: safeCanonical(page.userCanonical),
    indexingState: page.indexingState ?? null,
    pageFetchState: details.pageFetchState ?? null,
  });
}

/** An unanswered inspection is unknown, not evidence that Google excluded the page. */
export function unavailableGscTaskInspection(
  pageUrl: string,
): SeoTaskIndexedPage {
  return {
    pageUrl,
    verdict: "VERDICT_UNSPECIFIED",
    coverageState: null,
    indexingState: null,
    robotsTxtState: null,
    pageFetchState: null,
    lastCrawlTime: null,
    googleCanonical: null,
    userCanonical: null,
  };
}

/** Keep Google's limited, property-covered examples private. These never become crawl or inspection targets. */
export function privateInspectionDiscoverySources(
  pageUrl: string,
  raw: Record<string, unknown>,
  access: { propertyId: string; connectionVersion: string },
) {
  const examples = inspectionDiscoverySources(raw);
  const safe = (values: string[] | undefined, sitemap: boolean) =>
    values?.filter((value) => {
      if (!gscPropertyCovers(access.propertyId, [value])) return false;
      try {
        requireSeoEvidenceUrl(value, pageUrl, sitemap, access);
        return true;
      } catch {
        return false;
      }
    });
  const reportedSitemaps = safe(examples.reportedSitemaps, true);
  const referringPages = safe(examples.referringPages, false);
  if (!reportedSitemaps?.length && !referringPages?.length) return;
  return {
    pageUrl,
    ...(reportedSitemaps?.length && { reportedSitemaps }),
    ...(referringPages?.length && { referringPages }),
  };
}
