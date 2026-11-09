import { z } from "@hono/zod-openapi";

import {
  type SeoIndexedPage,
  seoIndexedPageSchema,
} from "@/schemas/project-seo.schema";

export const GSC_INSPECT_TOOL = "GOOGLE_SEARCH_CONSOLE_INSPECT_URL";
const optionalText = z.string().optional();
const inspectionSchema = z.object({
  inspectionResult: z.object({
    indexStatusResult: z.object({
      verdict: seoIndexedPageSchema.shape.verdict,
      coverageState: optionalText,
      robotsTxtState: optionalText,
      lastCrawlTime: optionalText,
      googleCanonical: optionalText,
      userCanonical: optionalText,
    }),
  }),
});

const CANONICAL_LIMIT = 2048;
/** A canonical is shown as a link, so only a readable http(s) address is kept. */
function canonical(value: string | undefined): string | null {
  if (!value || value.length > CANONICAL_LIMIT || !URL.canParse(value))
    return null;
  return ["http:", "https:"].includes(new URL(value).protocol) ? value : null;
}

/** One page per call; the page must sit under the property. */
export function gscInspectionArguments(
  propertyId: string,
  pageUrl: string,
): Record<string, unknown> {
  return { site_url: propertyId, inspection_url: pageUrl };
}

/**
 * Validates one URL Inspection answer. A missing index result or an unknown
 * verdict refuses it. Google omits fields it has no value for; they stay null,
 * and so does a canonical that is not an http(s) address.
 */
export function normalizeGscInspection(
  pageUrl: string,
  input: unknown,
): SeoIndexedPage {
  const result =
    inspectionSchema.parse(input).inspectionResult.indexStatusResult;
  return seoIndexedPageSchema.parse({
    pageUrl,
    verdict: result.verdict,
    coverageState: result.coverageState ?? null,
    robotsTxtState: result.robotsTxtState ?? null,
    lastCrawlTime: result.lastCrawlTime ?? null,
    googleCanonical: canonical(result.googleCanonical),
    userCanonical: canonical(result.userCanonical),
  });
}
