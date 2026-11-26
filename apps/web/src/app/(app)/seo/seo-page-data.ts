import "server-only";

import { cacheLife } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";
import { seoService } from "@/lib/services/seo.service";

import { collectCursorPages } from "@/lib/utils/collect-cursor-pages";
import { SEO_AUDIT_LIST_PAGE_MAX } from "./components/seo-audit-status";

type SeoAuditIndexInput = NonNullable<
  Parameters<typeof seoService.listAudits>[0]
>;

type SeoAuditIndex = Awaited<ReturnType<typeof seoService.listAudits>>;

async function readPrivateCachedSeoAuditIndex(
  input: SeoAuditIndexInput,
): Promise<SeoAuditIndex> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  return seoService.listAudits(input);
}

/**
 * The SEO Audit list, cached for the browser only, so a link prefetch
 * carries the page. A failed read is never kept: the page then renders
 * fresh on the click, with the same read uncached.
 */
export function loadSeoAuditIndex(
  input: SeoAuditIndexInput,
): Promise<SeoAuditIndex> {
  return readPrivateCachedSeoAuditIndex(input).catch(async (error: unknown) => {
    unstable_rethrow(error);
    await connection();
    return seoService.listAudits(input);
  });
}

/** Search starts at the first page even when opened from a later page of reports. */
export async function loadSeoAuditSearch(
  input: Pick<SeoAuditIndexInput, "projectId" | "status">,
) {
  const load = (cursor?: string) =>
    loadSeoAuditIndex({ ...input, limit: SEO_AUDIT_LIST_PAGE_MAX, cursor });
  const first = await load();
  return collectCursorPages(
    first.audits,
    first.pagination?.nextCursor,
    async (cursor) => {
      const page = await load(cursor);
      return { items: page.audits, nextCursor: page.pagination?.nextCursor };
    },
  );
}
