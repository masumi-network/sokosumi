import type { SeoTaskIndexedPage } from "@/schemas/seo-task-indexing.schema";
import { gscPropertyCovers } from "./native-gsc-property";

/** Only a Core-owned inspection can distinguish Google's unknown from an unanswered provider request. */
export function googleReturnedUnknown(
  receipt: {
    propertyId?: string | null;
    providerAnsweredAll?: true;
    answeredUnknownPageUrls?: string[];
  },
  page: Pick<SeoTaskIndexedPage, "pageUrl" | "verdict"> &
    Partial<SeoTaskIndexedPage>,
): boolean {
  if (
    page.verdict !== "VERDICT_UNSPECIFIED" ||
    (receipt.propertyId &&
      !gscPropertyCovers(receipt.propertyId, [page.pageUrl]))
  )
    return false;
  return Boolean(
    (receipt.propertyId &&
      (receipt.providerAnsweredAll ||
        receipt.answeredUnknownPageUrls?.includes(page.pageUrl))) ||
      [
        page.coverageState,
        page.indexingState,
        page.robotsTxtState,
        page.pageFetchState,
        page.lastCrawlTime,
        page.googleCanonical,
        page.userCanonical,
      ].some(Boolean),
  );
}
