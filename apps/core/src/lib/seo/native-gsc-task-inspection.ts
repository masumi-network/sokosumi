import { z } from "@hono/zod-openapi";
import {
  type SeoTaskIndexedPage,
  seoTaskIndexedPageSchema,
} from "@/schemas/seo-task-indexing.schema";
import { normalizeGscInspection } from "./native-gsc-inspection";

const detailsSchema = z.object({
  inspectionResult: z.object({
    indexStatusResult: z.object({
      indexingState: z.string().max(100).optional(),
      pageFetchState: z.string().max(100).optional(),
    }),
  }),
});

/** Reuse the display parser and retain the two extra fields needed by the worker's triage. */
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
    indexingState: details.indexingState ?? null,
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
