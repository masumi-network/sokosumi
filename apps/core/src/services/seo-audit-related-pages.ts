import { z } from "zod";

import { conflict } from "@/helpers/error";
import {
  originalSeoAuditPacket,
  selectSeoRelatedPages,
} from "@/lib/seo/related-page-selection";
import { seoRelatedIndexingSelectionSchema } from "@/schemas/seo-task-pages.schema";

/** The extra URLs are private indexing evidence. They never become saved pages or widen the public report. */
export function seoAuditInspectionPages(
  request: unknown,
  pageUrls: string[],
): string[] {
  const metadata = z
    .object({
      inspectRelated: z.boolean().optional(),
      searchConsoleAccess: z.unknown().optional(),
      relatedIndexingSelection: z.unknown().optional(),
    })
    .parse(request);
  if (metadata.relatedIndexingSelection === undefined) {
    if (metadata.inspectRelated)
      throw conflict("Prepare the related indexing targets before inspection");
    return pageUrls;
  }
  originalSeoAuditPacket(request);
  const selection = seoRelatedIndexingSelectionSchema.parse(
    metadata.relatedIndexingSelection,
  );
  if (JSON.stringify(selection.seedPageUrls) !== JSON.stringify(pageUrls))
    throw conflict("The approved audit seed pages changed");
  return selectSeoRelatedPages(
    pageUrls,
    selection.relatedPageUrls,
    metadata.searchConsoleAccess,
  );
}
